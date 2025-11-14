// functions/view/[id].js

export async function onRequest(context) {
  const { request, params } = context;

  const url = new URL(request.url);
  const id = params.id; // 包含 .jpg / .png 后缀的那一整段

  // 用我们的域名去请求原来的 /file/ 路由
  const fileUrl = `${url.origin}/file/${id}`;

  // 不要带浏览器那些 If-Modified-Since / If-None-Match 头，避免 304
  const upstream = await fetch(fileUrl, {
    method: "GET",
    headers: {
      // 最少的头就行，避免把浏览器的条件请求头传过去
      "User-Agent": request.headers.get("User-Agent") || "",
      "Accept": request.headers.get("Accept") || "*/*",
    },
  });

  if (!upstream.ok) {
    // 源站都失败了，就把错误原样给浏览器
    return upstream;
  }

  const buffer = await upstream.arrayBuffer();
  const contentType = upstream.headers.get("Content-Type") || "image/jpeg";

  return new Response(buffer, {
    headers: {
      // 关键：告诉浏览器这是一张图，并且要 inline 展示
      "Content-Type": contentType,
      "Content-Disposition": "inline",

      // 尽量让中间缓存都缓存一年
      "Cache-Control": "public, max-age=31536000",

      // 方便你在别的网站（比如单词卡）里跨域引用
      "Access-Control-Allow-Origin": "*",
    },
  });
}
