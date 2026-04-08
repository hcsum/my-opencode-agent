function firstDefined(
  ...values: Array<string | undefined>
): string | undefined {
  for (const value of values) {
    if (value && value.trim()) return value;
  }
  return undefined;
}

export const config = {
  proxyBaseUrl:
    firstDefined(process.env.CDP_PROXY_BASE_URL) || "http://127.0.0.1:3456",
  timeouts: {
    proxyRequest: 30_000,
  },
  webAccessHint:
    "The local browser proxy is not reachable. Run the web-access check first so the CDP proxy is started, then retry.",
};
