export const EXTRACT_SEARCH_RESULTS_JS = `
(function() {
  function trimText(text) {
    return (text || "").trim();
  }

  var results = [];
  var seenUrls = {};

  var anchors = document.querySelectorAll("a[href]");

  for (var i = 0; i < anchors.length; i++) {
    var a = anchors[i];
    var href = a.href || "";
    var text = trimText(a.textContent);

    if (!href.includes("/topic/") && !href.includes("/experience/") && !href.includes("/tutorial/")) continue;
    if (!text || text.length < 5) continue;

    if (seenUrls[href]) continue;
    seenUrls[href] = true;

    var parent = a.closest("div");
    var preview = "";
    if (parent) {
      var ps = parent.querySelectorAll("p");
      for (var j = 0; j < ps.length; j++) {
        var pt = trimText(ps[j].textContent);
        if (pt.length > 20 && !pt.includes("收藏") && !pt.includes("条结果")) {
          preview = pt.slice(0, 150);
          break;
        }
      }
    }

    results.push({
      title: text,
      url: href,
      preview: preview
    });
  }

  return results;
})()
`;
