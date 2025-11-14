export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  const id = url.searchParams.get("id") || url.searchParams.get("file");
  if (!id) {
    return new Response("Missing id", { status: 400 });
  }

  // 调用原始 /file 路由
  const fileUrl = `${url.origin}/file/${id}`;

  const upstream = await fetch(fileUrl);

  if (!upstream.ok) return upstream;

  const buf = await upstream.arrayBuffer();
  const type = upstream.headers.get("Content-Type") || "image/jpeg";

  return new Response(buf, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": "inline",
      "Cache-Control": "public, max-age=31536000",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
