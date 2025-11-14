export async function onRequest(context) {
    const { request, env, params } = context;

    const url = new URL(request.url);
    let fileUrl = 'https://telegra.ph' + url.pathname + url.search;

    // Path length > 39 indicates file uploaded via Telegram Bot API
    if (url.pathname.length > 39) {
        const formdata = new FormData();
        formdata.append("file_id", url.pathname);

        // /file/AgACAgEAAxkDAAMDZt1Gzs4W8dQPWiQJxO5YSH5X-gsAAt-sMRuWNelGOSaEM_9lHHgBAAMCAANtAAM2BA.png
        // get the AgACAgEAAxkDAAMDZt1Gzs4W8dQPWiQJxO5YSH5X-gsAAt-sMRuWNelGOSaEM_9lHHgBAAMCAANtAAM2BA
        const fileId = url.pathname.split(".")[0].split("/")[2];
        console.log("file_id:", fileId);

        const filePath = await getFilePath(env, fileId);
        console.log("file_path:", filePath);

        if (filePath) {
            fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
        }
    }

    // 先请求源文件
    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    // 源站都挂了就没得救，原样返回错误
    if (!response.ok) return response;

    console.log(response.ok, response.status);

    const isAdmin = request.headers.get("Referer")?.includes(`${url.origin}/admin`);

    // ---------- 如果是 admin 页面：跳过 KV、白名单等逻辑，直接返回文件，但改成 inline 显示 ----------
    if (isAdmin) {
        const adminBuffer = await response.arrayBuffer();
        const adminType = response.headers.get("Content-Type") || "image/jpeg";

        return new Response(adminBuffer, {
            headers: {
                "Content-Type": adminType,
                "Content-Disposition": "inline",
                "Cache-Control": "public, max-age=31536000",
                "Access-Control-Allow-Origin": "*",
            },
        });
    }

    // ---------- 如果没有 KV，直接返回图片，但改成 inline + 缓存 ----------
    if (!env.img_url) {
        console.log("KV storage not available, returning image directly (inline)");

        const buf = await response.arrayBuffer();
        const ct = response.headers.get("Content-Type") || "image/jpeg";

        return new Response(buf, {
            headers: {
                "Content-Type": ct,
                "Content-Disposition": "inline",
                "Cache-Control": "public, max-age=31536000",
                "Access-Control-Allow-Origin": "*",
            },
        });
    }

    // ---------- 有 KV 的情况：读取 / 初始化 metadata ----------
    let record = await env.img_url.getWithMetadata(params.id);
    if (!record || !record.metadata) {
        console.log("Metadata not found, initializing...");
        record = {
            metadata: {
                ListType: "None",
                Label: "None",
                TimeStamp: Date.now(),
                liked: false,
                fileName: params.id,
                fileSize: 0,
            },
        };
        await env.img_url.put(params.id, "", { metadata: record.metadata });
    }

    const metadata = {
        ListType: record.metadata.ListType || "None",
        Label: record.metadata.Label || "None",
        TimeStamp: record.metadata.TimeStamp || Date.now(),
        liked: record.metadata.liked !== undefined ? record.metadata.liked : false,
        fileName: record.metadata.fileName || params.id,
        fileSize: record.metadata.fileSize || 0,
    };

    // ---------- 白名单 / 黑名单 / 成人内容处理 ----------
    if (metadata.ListType === "White") {
        // 白名单：直接放行，但我们还是改成 inline + 缓存
        const whiteBuf = await response.arrayBuffer();
        const whiteType = response.headers.get("Content-Type") || "image/jpeg";

        return new Response(whiteBuf, {
            headers: {
                "Content-Type": whiteType,
                "Content-Disposition": "inline",
                "Cache-Control": "public, max-age=31536000",
                "Access-Control-Allow-Origin": "*",
            },
        });
    } else if (metadata.ListType === "Block" || metadata.Label === "adult") {
        const referer = request.headers.get("Referer");
        const redirectUrl = referer
            ? "https://static-res.pages.dev/teleimage/img-block-compressed.png"
            : `${url.origin}/block-img.html`;
        return Response.redirect(redirectUrl, 302);
    }

    // 如果开启了白名单模式，非白名单一律拦截
    if (env.WhiteList_Mode === "true") {
        return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
    }

    // ---------- 内容安全检测 ----------
    if (env.ModerateContentApiKey) {
        try {
            console.log("Starting content moderation...");
            const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=https://telegra.ph${url.pathname}${url.search}`;
            const moderateResponse = await fetch(moderateUrl);

            if (!moderateResponse.ok) {
                console.error("Content moderation API request failed: " + moderateResponse.status);
            } else {
                const moderateData = await moderateResponse.json();
                console.log("Content moderation results:", moderateData);

                if (moderateData && moderateData.rating_label) {
                    metadata.Label = moderateData.rating_label;

                    if (moderateData.rating_label === "adult") {
                        console.log("Content marked as adult, saving metadata and redirecting");
                        await env.img_url.put(params.id, "", { metadata });
                        return Response.redirect(`${url.origin}/block-img.html`, 302);
                    }
                }
            }
        } catch (error) {
            console.error("Error during content moderation: " + error.message);
            // 审核失败不要影响用户体验，继续往下走
        }
    }

    // ---------- 正常内容：保存 metadata ----------
    console.log("Saving metadata");
    await env.img_url.put(params.id, "", { metadata });

    // ---------- 最后统一包装响应：inline + CF 缓存 ----------
    const fileBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("Content-Type") || "image/jpeg";

    return new Response(fileBuffer, {
        headers: {
            "Content-Type": contentType,                   // 让浏览器正确渲染
            "Content-Disposition": "inline",              // 不再触发下载
            "Cache-Control": "public, max-age=31536000",  // 让 Cloudflare 缓存 1 年
            "Access-Control-Allow-Origin": "*",           // 允许前端跨域引用
        },
    });
}

// 保留原来的 getFilePath 函数（你之前文件里的那段）
async function getFilePath(env, file_id) {
    try {
        const url = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
        const res = await fetch(url, {
            method: "GET",
        });

        if (!res.ok) {
            console.error(`HTTP error! status: ${res.status}`);
            return null;
        }

        const responseData = await res.json();
        const { ok, result } = responseData;

        if (ok && result) {
            return result.file_path;
        } else {
            console.error("Error in response data:", responseData);
            return null;
        }
    } catch (error) {
        console.error("Error fetching file path:", error.message);
        return null;
    }
}
