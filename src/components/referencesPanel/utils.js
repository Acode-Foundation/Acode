import {
  EditorView
} from "@codemirror/view";
import Sidebar from "components/sidebar";
import toast from "components/toast";
import DOMPurify from "dompurify";
import openFile from "lib/openFile";
import {
  addedFolder
} from "lib/openFolder";
import {
  clearHighlightCache,
  highlightLine,
  sanitize,
} from "utils/codeHighlight";
import helpers from "utils/helpers";
import Uri from "utils/Uri";
import Url from "utils/Url";

export {
  clearHighlightCache,
  sanitize
};

export function getFilename(uri) {
  if (!uri) return "";
  try {
    const decoded = decodeURIComponent(uri);
    const parts = decoded.split("/").filter(Boolean);
    return parts.pop() || "";
  } catch {
    const parts = uri.split("/").filter(Boolean);
    return parts.pop() || "";
  }
}

export function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function groupReferencesByFile(references) {
  const grouped = {};
  for (const ref of references) {
    if (!grouped[ref.uri]) {
      grouped[ref.uri] = [];
    }
    grouped[ref.uri].push(ref);
  }
  return grouped;
}

export async function buildFlatList(references, symbolName) {
  const grouped = groupReferencesByFile(references);

  const items = [];
  for (const [uri, fileRefs] of Object.entries(grouped)) {
    fileRefs.sort((a, b) => a.range.start.line - b.range.start.line);

    items.push({
      type: "file-header",
      uri,
      fileName: getFilename(uri),
      count: fileRefs.length,
    });

    for (const ref of fileRefs) {
      const highlightedText = await highlightLine(
        ref.lineText || "",
        uri,
        symbolName,
      );

      items.push({
        type: "reference",
        uri,
        ref,
        line: ref.range.start.line + 1,
        lineText: ref.lineText || "",
        highlightedText,
        symbol: symbolName,
      });
    }
  }
  return items;
}

export function createReferenceItem(item, options = {}) {
  const {
    collapsedFiles,
    onToggleFile,
    onNavigate
  } = options;

  if (item.type === "file-header") {
    const isCollapsed = collapsedFiles?.has(item.uri);
    const iconClass = helpers.getIconForFile(item.fileName);

    const $el = (
      <div
        className={`ref-file-header ${isCollapsed ? "collapsed": ""}`}
        onclick={() => onToggleFile?.(item.uri)}
        >
        <span className="icon chevron keyboard_arrow_down" />
        <span className={`${iconClass} file-icon`} />
        <span className="file-name">{sanitize(item.fileName)}</span>
        <span className="ref-count">{item.count}</span>
      </div>
    );

    return $el;
  }

  const $el = (
    <div className="ref-item" onclick={() => onNavigate?.(item.ref)}>
      <span className="line-number">{item.line}</span>
      <span className="ref-preview" />
    </div>
  );

  $el.get(".ref-preview").innerHTML = DOMPurify.sanitize(item.highlightedText);

  return $el;
}

export async function navigateToReference(ref) {
  Sidebar.hide();

  try {
    let targetUri = ref.uri;

    if (
      targetUri.startsWith("file:///") &&
      !editorManager.getFile(targetUri, "uri")
    ) {
      const contentUri = resolveContentUriForFileUri(targetUri);
      if (contentUri) {
        targetUri = contentUri;
      } else {
        toast("Definition unreachable");
        return;
      }
    }

    await openFile(targetUri, {
      render: true
    });
    const {
      editor
    } = editorManager;
    if (!editor) return;

    const doc = editor.state.doc;
    const startLine = doc.line(ref.range.start.line + 1);
    const endLine = doc.line(ref.range.end.line + 1);
    const from = Math.min(
      startLine.from + ref.range.start.character,
      startLine.to,
    );
    const to = Math.min(endLine.from + ref.range.end.character, endLine.to);

    editor.dispatch({
      selection: {
        anchor: from, head: to
      },
      effects: EditorView.scrollIntoView(from, {
        y: "center"
      }),
    });
    editor.focus();
  } catch (error) {
    console.error("Failed to navigate to reference:", error);
  }
}

export function getReferencesStats(references) {
  const fileCount = new Set(references.map((r) => r.uri)).size;
  const refCount = references.length;
  return {
    fileCount,
    refCount,
    text: `${refCount} reference${refCount !== 1 ? "s": ""} in ${fileCount} file${fileCount !== 1 ? "s": ""}`,
  };
}

function docIdToRealPath(docId) {
  const sepIndex = docId.indexOf(":");
  if (sepIndex === -1) return null;
  const volume = docId.slice(0, sepIndex);
  const remainder = docId.slice(sepIndex + 1);
  const base =
  volume === "primary" ? "/storage/emulated/0": `/storage/${volume}`;
  return remainder ? `${base}/${remainder}`: base;
}

const CONTENT_AUTHORITY_HANDLERS = {
  "android.externalstorage": {
    docIdToPath(docId) {
      const trimmed = docId.replace(/:+$/, "");
      const separator = trimmed.indexOf(":");
      if (separator === -1) return null;
      const volume = trimmed.slice(0, separator);
      const remainder = trimmed.slice(separator + 1);
      if (!remainder) return null;
      const base =
      volume === "primary" ? "/storage/emulated/0": `/storage/${volume}`;
      return `${base}/${remainder}`;
    },
  },
  "foxdebug.acode": {
    docIdToPath(docId) {
      let normalized = docId.replace(/:+$/, "");
      if (!normalized) return null;
      if (normalized.startsWith("raw:/")) {
        normalized = normalized.slice(4);
      } else if (normalized.startsWith("raw:")) {
        normalized = normalized.slice(4);
      }
      return normalized.startsWith("/") ? normalized: null;
    },
  },
};
CONTENT_AUTHORITY_HANDLERS["foxdebug.acodefree"] =
CONTENT_AUTHORITY_HANDLERS["foxdebug.acode"];

function getContentAuthorityId(contentUri) {
  const match = /^content:\/\/com\.((?![:<>"/\\|?*]).*?)\.documents\//.exec(
    contentUri,
  );
  return match?.[1] ?? null;
}

/**
* LSP servers hand back plain file:// uris. Acode tracks externally-added
* files by their original content:// SAF uri, so an lsp uri never matches
* an open tab directly. Resolve it against the currently added folders
* (the only external files Acode can reach without a fresh SAF prompt)
* and rebuild the real content:// uri, same docId scheme openFolder.js
* already relies on elsewhere in this codebase.
*/
export function resolveContentUriForFileUri(fileUri) {
  if (!fileUri?.startsWith("file:///")) return null;
  const targetPath = decodeURIComponent(fileUri.slice("file://".length));

  for (const folder of addedFolder) {
    const rootUrl = folder?.url;
    if (!rootUrl) continue;

    if (rootUrl.startsWith("content:")) {
      let parsed;
      try {
        parsed = Uri.parse(rootUrl);
      } catch {
        continue;
      }
      const authorityId = getContentAuthorityId(parsed.rootUri ?? rootUrl);
      const handler = authorityId && CONTENT_AUTHORITY_HANDLERS[authorityId];
      if (!handler) continue;

      const rootPath = handler.docIdToPath(parsed.docId);
      if (!rootPath) continue;

      if (targetPath === rootPath) {
        return Uri.format(parsed.rootUri, parsed.docId);
      }
      if (targetPath.startsWith(`${rootPath}/`)) {
        const suffix = targetPath.slice(rootPath.length); // leading "/"
        const childDocId = parsed.docId.endsWith("/")
        ? parsed.docId.slice(0, -1) + suffix: parsed.docId + suffix;
        return Uri.format(parsed.rootUri, childDocId);
      }
      continue;
    }


    if (rootUrl.startsWith("sftp:")) {
      let parts;
      try {
        parts = Url.decodeUrl(rootUrl);
      } catch {
        continue;
      }
      const rootPath = (parts.pathname || "").replace(/\/+$/, "");
      if (!rootPath) continue;

      let childPath = null;
      if (targetPath === rootPath) {
        childPath = rootPath;
      } else if (targetPath.startsWith(`${rootPath}/`)) {
        childPath = targetPath;
      } else {
        continue;
      }

      return Url.formate({
        protocol: "sftp:",
        hostname: parts.hostname,
        username: parts.username,
        password: parts.password,
        port: parts.port,
        path: childPath,
        query: parts.query,
      });
    }
    if (rootUrl.startsWith("file:")) {
      let rootPath;
      try {
        rootPath = decodeURIComponent(rootUrl.slice("file://".length)).replace(/\/+$/, "");
      } catch {
        continue;
      }
      if (!rootPath) continue;

      // Android: /data/user/0/<pkg> is a symlink to /data/data/<pkg>
      // Normalize both sides so the comparison works regardless of which
      // representation Acode and the LSP each use.
      const normalizeAndroidPath = (p) =>
      p.replace(/^\/data\/user\/0\//, "/data/data/");

      const nTarget = normalizeAndroidPath(targetPath);
      const nRoot = normalizeAndroidPath(rootPath);

      if (nTarget === nRoot) return rootUrl;
      if (nTarget.startsWith(`${nRoot}/`)) {
        const suffix = nTarget.slice(nRoot.length); // leading "/"
        return rootUrl.replace(/\/+$/, "") + suffix;
      }
      continue;
    }

  }

  return null;
}