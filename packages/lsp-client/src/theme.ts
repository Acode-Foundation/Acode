import {EditorView} from "@codemirror/view"

export const lspTheme = EditorView.baseTheme({
  ".cm-lsp-documentation": {
    padding: "0 7px",
    "& p, & pre": {
      margin: "2px 0"
    }
  },

  ".cm-lsp-signature-tooltip": {
    padding: "2px 6px",
    borderRadius: "2.5px",
    position: "relative",
    maxWidth: "30em",
    maxHeight: "10em",
    overflowY: "scroll",
    "& .cm-lsp-documentation": {
      padding: "0",
      fontSize: "80%",
    },
    "& .cm-lsp-signature-num": {
      fontFamily: "monospace",
      position: "absolute",
      left: "2px", top: "4px",
      fontSize: "70%",
      lineHeight: "1.3"
    },
    "& .cm-lsp-signature": {
      fontFamily: "monospace",
      textIndent: "1em hanging",
    },
    "& .cm-lsp-active-parameter": {
      fontWeight: "bold"
    },
  },
  ".cm-lsp-signature-multiple": {
    paddingLeft: "1.5em"
  },

  ".cm-panel.cm-lsp-rename-panel": {
    padding: "2px 6px 4px",
    position: "relative",
    "& label": { fontSize: "80%" },
    "& [name=close]": {
      position: "absolute",
      top: "0", bottom: "0",
      right: "4px",
      backgroundColor: "inherit",
      border: "none",
      font: "inherit",
      padding: "0"
    }
  },

  ".cm-lsp-message button[type=submit]": {
    display: "block"
  },

  ".cm-lsp-reference-panel": {
    fontFamily: "monospace",
    whiteSpace: "pre",
    padding: "3px 6px",
    maxHeight: "120px",
    overflow: "auto",
    "& .cm-lsp-reference-file": {
      fontWeight: "bold",
    },
    "& .cm-lsp-reference": {
      cursor: "pointer",
      "&[aria-selected]": {
        backgroundColor: "#0077ee44"
      },
    },
    "& .cm-lsp-reference-line": {
      opacity: "0.7",
    },
  },
})
