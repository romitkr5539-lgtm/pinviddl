/**
 * Premium Pinterest Downloader - Cloudflare Worker Backend
 * Highly optimized, zero external dependency, handles media extractions & CORS.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Stream extracted Pinterest media as a browser download without exposing a local proxy route.
    if (url.pathname === "/api/proxy" && request.method === "GET") {
      const target = url.searchParams.get("url") || "";
      const filename = (url.searchParams.get("filename") || "pinterest_media")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .slice(0, 80);

      let mediaUrl;
      try {
        mediaUrl = new URL(target);
      } catch (e) {
        return new Response(JSON.stringify({ success: false, message: "Invalid media URL" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      if (mediaUrl.protocol !== "https:" || !mediaUrl.hostname.endsWith(".pinimg.com")) {
        return new Response(JSON.stringify({ success: false, message: "Unsupported media host" }), {
          status: 403,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const mediaResponse = await fetch(mediaUrl.toString(), {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
          "Referer": "https://www.pinterest.com/"
        }
      });

      if (!mediaResponse.ok || !mediaResponse.body) {
        return new Response(JSON.stringify({ success: false, message: "Media could not be fetched" }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const contentType = mediaResponse.headers.get("content-type") || "application/octet-stream";
      const extension = contentType.includes("mp4") ? ".mp4"
        : contentType.includes("gif") ? ".gif"
        : contentType.includes("png") ? ".png"
        : ".jpg";
      const inline = url.searchParams.get("inline") === "true";

      return new Response(mediaResponse.body, {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": contentType,
          "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}${extension}"`,
          "Cache-Control": "public, max-age=3600"
        }
      });
    }

    // Support both GET /?url=... and POST json { url: ... }
    let pinUrl = "";
    if (request.method === "POST") {
      try {
        const body = await request.json();
        pinUrl = body.url || "";
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: "bad_request", message: "Invalid JSON body" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    } else if (request.method === "GET") {
      pinUrl = url.searchParams.get("url") || "";
    }

    if (!pinUrl) {
      return new Response(JSON.stringify({
        success: false,
        error: "url_required",
        message: "Pinterest Pin URL is required."
      }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    pinUrl = pinUrl.trim();

    try {
      // 1. Follow Short URL redirects (like pin.it)
      if (pinUrl.includes("pin.it")) {
        const redirectRes = await fetch(pinUrl, {
          method: "GET",
          redirect: "manual",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          }
        });
        const redirectLoc = redirectRes.headers.get("location");
        if (redirectLoc) {
          pinUrl = redirectLoc;
        }
      }

      // 2. Fetch the target Pinterest page
      const pinResponse = await fetch(pinUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp",
        }
      });

      if (!pinResponse.ok) {
        return new Response(JSON.stringify({
          success: false,
          error: "pinterest_fetch_failed",
          message: `Pinterest returned status ${pinResponse.status}`
        }), {
          status: 422,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const html = await pinResponse.text();

      // 3. Extract Metadata Title & Description
      let title = "Pinterest Pin";
      const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)
        || html.match(/<meta\s+name=["']title["']\s+content=["']([^"']+)["']/i);
      if (ogTitleMatch && ogTitleMatch[1]) {
        title = ogTitleMatch[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"');
      }

      let description = "Pinterest downloaded media";
      const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
      if (ogDescMatch && ogDescMatch[1]) {
        description = ogDescMatch[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"');
      }

      let ogImage = "";
      const ogImageMatch = html.match(/<meta\s+(?:property|name)=["'](?:og:image|og:image:secure_url|twitter:image)["']\s+content=["']([^"']+)["']/i)
        || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:og:image|og:image:secure_url|twitter:image)["']/i)
        || html.match(/<link\s+rel=["']image_src["']\s+href=["']([^"']+)["']/i);
      if (ogImageMatch && ogImageMatch[1]) {
        ogImage = ogImageMatch[1].replace(/\\u002F/g, "/").replace(/\\\//g, "/").replace(/&amp;/g, "&");
      }

      const mediaList = [];

      // 4. Parse JSON-LD scripts for Video object extraction
      const jsonLdMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
      for (const match of jsonLdMatches) {
        try {
          const schema = JSON.parse(match[1].trim());
          const items = Array.isArray(schema) ? schema : [schema];
          for (const item of items) {
            if (item["@type"] === "VideoObject" || item.video || item.contentUrl?.endsWith(".mp4")) {
              const videoUrl = item.contentUrl || item.embedUrl || (item.video && item.video.contentUrl);
              if (videoUrl && typeof videoUrl === "string") {
                mediaList.push({
                  type: "video",
                  url: videoUrl,
                  quality: "HD Video (MP4)"
                });
              }
            }
            if (item.image) {
              const imgUrl = typeof item.image === "string" ? item.image : (item.image.url || item.image[0]);
              if (imgUrl && typeof imgUrl === "string") {
                const originalUrl = imgUrl.replace(/(i\.pinimg\.com\/)\d+x\b/, "$1originals");
                mediaList.push({
                  type: "image",
                  url: originalUrl,
                  quality: "Original HD Image (JPG)"
                });
              }
            }
          }
        } catch (e) {}
      }

      // 5. Check Open Graph video tags
      const ogVideoMatch = html.match(/<meta\s+property=["']og:video["']\s+content=["']([^"']+)["']/i)
        || html.match(/<meta\s+property=["']og:video:secure_url["']\s+content=["']([^"']+)["']/i);
      if (ogVideoMatch && ogVideoMatch[1]) {
        const vUrl = ogVideoMatch[1];
        if (!mediaList.some(item => item.url === vUrl)) {
          mediaList.push({
            type: "video",
            url: vUrl,
            quality: "HD Video (MP4)"
          });
        }
      }

      // 6. Check __PWS_DATA__ or initial-state string parsing
      const pwsMatch = html.match(/<script\s+id=["']__PWS_DATA__["']\s+type=["']application\/json["']>([\s\S]*?)<\/script>/i)
        || html.match(/<script\s+id=["']initial-state["']\s+type=["']application\/json["']>([\s\S]*?)<\/script>/i);
      
      if (pwsMatch && pwsMatch[1]) {
        const rawJson = pwsMatch[1];
        const mp4Matches = rawJson.matchAll(/["'](https:\/\/v1\.pinimg\.com\/[^\s"':,]+?\.mp4)["']/g);
        for (const m of mp4Matches) {
          if (m[1] && !mediaList.some(item => item.url === m[1])) {
            mediaList.push({
              type: "video",
              url: m[1],
              quality: "HD Video (MP4)"
            });
          }
        }
        const imgMatches = rawJson.matchAll(/(?:https?:\\?\/\\?\/i\.pinimg\.com\\?\/\\?(?:originals|\d+x)\\?\/[^\s"'\\]+?\.(?:jpg|jpeg|png|gif)(?:\?[^\s"'\\]+)?)/gi);
        for (const m of imgMatches) {
          const imageUrl = m[0].replace(/\\u002F/g, "/").replace(/\\\//g, "/");
          if (imageUrl) {
            const type = imageUrl.toLowerCase().includes(".gif") ? "gif" : "image";
            const originalUrl = imageUrl.replace(/(i\.pinimg\.com\/)(?:\d+x|originals)\//i, "$1originals/");
            if (!mediaList.some(item => item.url === originalUrl)) {
              mediaList.push({
                type: type,
                url: originalUrl,
                quality: type === "gif" ? "High Quality GIF" : "Original Ultra HD (JPG/PNG)"
              });
            }
          }
        }
      }

      // 7. Scan the complete page for escaped or resized Pinterest image URLs.
      if (!mediaList.some(item => item.type === "image" || item.type === "gif")) {
        const pageImageMatches = html.matchAll(/https?:\\?\/\\?\/i\.pinimg\.com\\?\/\\?(?:originals|\d+x)\\?\/[^\s"'<>\\]+?\.(?:jpg|jpeg|png|gif)(?:\?[^\s"'<>\\]+)?/gi);
        for (const match of pageImageMatches) {
          const imageUrl = match[0].replace(/\\u002F/g, "/").replace(/\\\//g, "/");
          const originalUrl = imageUrl.replace(/(i\.pinimg\.com\/)(?:\d+x|originals)\//i, "$1originals/");
          const type = originalUrl.toLowerCase().includes(".gif") ? "gif" : "image";
          if (!mediaList.some(item => item.url === originalUrl)) {
            mediaList.push({
              type,
              url: originalUrl,
              quality: type === "gif" ? "High Quality GIF" : "Original HD Image"
            });
          }
        }
      }

      // 8. Regex MP4 extraction backup
      if (mediaList.length === 0) {
        const mp4Regex = /https:\/\/v1\.pinimg\.com\/[a-zA-Z0-9_\-\.\/]+?\.mp4/g;
        const foundMp4s = html.match(mp4Regex);
        if (foundMp4s) {
          for (const mp4 of foundMp4s) {
            if (!mediaList.some(item => item.url === mp4)) {
              mediaList.push({
                type: "video",
                url: mp4,
                quality: "HD Video"
              });
            }
          }
        }
      }

      // Fallback to og:image if list remains empty
      if (ogImage && /https:\/\/(?:[a-z0-9-]+\.)*pinimg\.com\//i.test(ogImage)
        && !mediaList.some(item => item.url.includes(ogImage.split("/").pop() || "no-match"))) {
        const originalOgImg = ogImage.replace(/(i\.pinimg\.com\/)(?:\d+x|originals)\//i, "$1originals/");
        const isGif = originalOgImg.toLowerCase().includes(".gif");
        mediaList.push({
          type: isGif ? "gif" : "image",
          url: originalOgImg,
          quality: isGif ? "High Quality GIF" : "High Resolution Image"
        });
      }

      if (mediaList.length === 0) {
        return new Response(JSON.stringify({
          success: false,
          error: "no_media_found",
          message: "No clean download links could be extracted from this Pin. Please double check your URL."
        }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // Filter duplicates
      const uniqueMedia = mediaList.filter((item, index, self) =>
        index === self.findIndex((t) => t.url === item.url)
      );

      return new Response(JSON.stringify({
        success: true,
        title: title || "Pinterest Shared Media",
        description: description || "Pinterest downloaded media.",
        thumbnail: ogImage || uniqueMedia[0].url,
        media: uniqueMedia
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });

    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        error: "internal_worker_error",
        message: err.message || "An exception occurred inside the Worker."
      }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
  }
};
