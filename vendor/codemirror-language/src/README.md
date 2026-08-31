@languageDataProp

@Language

@defineLanguageFacet

@Sublanguage

@sublanguageProp

@language

@LRLanguage

@ParseContext

@syntaxTree

@ensureSyntaxTree

@syntaxTreeAvailable

@forceParsing

@syntaxParserRunning

@LanguageSupport

@LanguageDescription

@DocInput

### Highlighting

@HighlightStyle

@syntaxHighlighting

@TagStyle

@defaultHighlightStyle

@highlightingFor

@bidiIsolates

### Folding

These exports provide commands and other functionality related to code
folding (temporarily hiding pieces of code).

@foldService

@foldNodeProp

@foldInside

@foldable

@foldCode

@unfoldCode

@toggleFold

@foldAll

@unfoldAll

@foldKeymap

@codeFolding

@foldGutter

The following functions provide more direct, low-level control over
the fold state.

@foldedRanges

@foldState

@foldEffect

@unfoldEffect

### Indentation

@indentService

@indentNodeProp

@getIndentation

@indentRange

@indentUnit

@getIndentUnit

@indentString

@IndentContext

@TreeIndentContext

@delimitedIndent

@continuedIndent

@flatIndent

@indentOnInput

### Bracket Matching

@bracketMatching

@Config

@matchBrackets

@MatchResult

@bracketMatchingHandle

### Stream Parser

Stream parsers provide a way to adapt language modes written in the
CodeMirror 5 style (see
[@codemirror/legacy-modes](https://code.haverbeke.berlin/codemirror/legacy-modes))
to the `Language` interface.

@StreamLanguage

@StreamParser

@StringStream
