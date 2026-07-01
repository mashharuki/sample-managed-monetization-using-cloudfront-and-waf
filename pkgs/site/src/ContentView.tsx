/**
 * 有料の 200 ボディをコンテンツタイプに応じてレンダリングします：JSON（整形済み）、
 * Markdown（テーブル、見出し、リスト、太字を含む小さな組み込みレンダラー）、
 * または HTML（エッジフラグメント）。
 *
 * ボディは自社の信頼できるエッジ関数から来ますが、すべての HTML フラグメントは
 * DOM に到達する前に DOMPurify を通します（SafeHtml を参照）。サニタイズせずに
 * HTML を注入しないでください — 生の代入ではなく、このサニタイズ→レンダリングパターンをコピーしてください。
 */

import DOMPurify from "dompurify";
import { useEffect, useRef } from "react";

type Props = { contentType: string; body: string };

/**
 * サニタイズされた HTML フラグメントをレンダリングします。DOMPurify がスクリプト/ハンドラーを
 * 解析・除去し、replaceChildren 経由で接続するクリーンな DocumentFragment を返します —
 * したがって、生の HTML 文字列が DOM のマークアッププロパティに代入されることはありません。
 */
function SafeHtml({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const clean = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true });
    ref.current.replaceChildren(clean);
  }, [html]);
  return <div className="rendered" ref={ref} />;
}

function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // テーブル
    if (/^\|/.test(line) && /^\|[\s:|-]+\|?$/.test(lines[i + 1] || "")) {
      const cells = (l: string) =>
        l
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>` +
          rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("") +
          `</tbody></table>`,
      );
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      const lvl = line.match(/^#+/)?.[0].length;
      out.push(`<h${lvl}>${esc(line.replace(/^#+\s/, ""))}</h${lvl}>`);
    } else if (/^>\s?/.test(line)) {
      out.push(`<blockquote>${esc(line.replace(/^>\s?/, ""))}</blockquote>`);
    } else if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i]))
        items.push(`<li>${esc(lines[i++].replace(/^[-*]\s/, ""))}</li>`);
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    } else if (line.trim() === "") {
      out.push("");
    } else {
      out.push(`<p>${esc(line)}</p>`);
    }
    i++;
  }
  return out
    .join("\n")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>");
}

export function ContentView({ contentType, body }: Props) {
  if (!body) return <pre className="resp">—</pre>;
  if (contentType.includes("application/json")) {
    let pretty = body;
    try {
      pretty = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      /* そのまま表示 */
    }
    return <pre className="resp">{pretty}</pre>;
  }
  if (contentType.includes("markdown")) {
    return <SafeHtml html={mdToHtml(body)} />;
  }
  if (contentType.includes("html")) {
    return <SafeHtml html={body} />;
  }
  return <pre className="resp">{body}</pre>;
}
