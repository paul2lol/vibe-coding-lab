module.exports = async function handler(req, res) {
  const target = process.env.APPS_SCRIPT_URL;

  if (!target) {
    return res.status(500).json({ ok: false, error: "APPS_SCRIPT_URL env var is missing." });
  }

  try {
    const upstream = new URL(target);

    if (req.method === "GET") {
      Object.entries(req.query || {}).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          value.forEach((item) => upstream.searchParams.append(key, item));
        } else if (value !== undefined) {
          upstream.searchParams.set(key, String(value));
        }
      });

      const response = await fetch(upstream.toString(), {
        method: "GET",
        headers: { Accept: "application/json" }
      });
      const text = await response.text();
      res.status(response.status);
      res.setHeader("Content-Type", response.headers.get("content-type") || "application/json; charset=utf-8");
      return res.send(text);
    }

    if (req.method === "POST") {
      const response = await fetch(upstream.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: req.query.action, ...(req.body || {}) })
      });
      const text = await response.text();
      res.status(response.status);
      res.setHeader("Content-Type", response.headers.get("content-type") || "application/json; charset=utf-8");
      return res.send(text);
    }

    return res.status(405).json({ ok: false, error: "Method not allowed." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ ok: false, error: error.message || "Proxy error." });
  }
};
