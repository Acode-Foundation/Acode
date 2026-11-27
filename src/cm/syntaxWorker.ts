// The canvas renderer's syntax worker (built as build/syntaxWorker.js):
// parses documents for canvas views off the main thread. Views fall back
// to parsing themselves if it fails or lacks a document's language.
import { serveSyntax } from "@acode.app/canvas-view/worker";
import { syntaxParsers } from "./syntaxParsers";

serveSyntax(syntaxParsers);
