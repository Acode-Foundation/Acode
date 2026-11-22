import Foundation

/// Expands a replacement the way JavaScript's String.prototype.replace does
/// ($$, $&, $`, $', $1..$99, $<name>), so native regex replacements match the
/// JS worker path.
struct WorkspaceReplacement {
    let template: NSString
    let groupNames: Set<String>
    let literal: Bool

    init(_ template: String, pattern: String, regExp: Bool) {
        self.template = template as NSString
        literal = !regExp
        groupNames = regExp ? Self.groupNames(in: pattern) : []
    }

    func expand(_ match: NSTextCheckingResult, in source: NSString) -> String {
        if literal { return template as String }
        let out = NSMutableString(capacity: template.length)
        let groups = match.numberOfRanges - 1
        let dollar: unichar = 36
        var index = 0
        while index < template.length {
            let char = template.character(at: index)
            guard char == dollar, index + 1 < template.length else {
                out.append(template.substring(with: NSRange(location: index, length: 1)))
                index += 1
                continue
            }
            let next = template.character(at: index + 1)
            switch next {
            case dollar:
                out.append("$"); index += 2
            case 38: // &
                out.append(source.substring(with: match.range)); index += 2
            case 96: // `
                out.append(source.substring(to: match.range.location)); index += 2
            case 39: // '
                out.append(source.substring(from: NSMaxRange(match.range))); index += 2
            case 48...57:
                var group = Int(next) - 48
                var consumed = 1
                if index + 2 < template.length, case 48...57 = template.character(at: index + 2) {
                    let twoDigit = group * 10 + Int(template.character(at: index + 2)) - 48
                    if twoDigit >= 1 && twoDigit <= groups { group = twoDigit; consumed = 2 }
                }
                if group >= 1 && group <= groups {
                    append(match.range(at: group), from: source, to: out)
                    index += 1 + consumed
                } else {
                    out.append("$"); index += 1
                }
            case 60 where !groupNames.isEmpty: // <
                let close = template.range(of: ">", range: NSRange(location: index + 2, length: template.length - index - 2))
                guard close.location != NSNotFound else { out.append("$"); index += 1; continue }
                let name = template.substring(with: NSRange(location: index + 2, length: close.location - index - 2))
                // JS: an unknown name expands to nothing once the pattern has named groups.
                if groupNames.contains(name) { append(match.range(withName: name), from: source, to: out) }
                index = close.location + 1
            default:
                out.append("$"); index += 1
            }
        }
        return out as String
    }

    private func append(_ range: NSRange, from source: NSString, to out: NSMutableString) {
        if range.location != NSNotFound { out.append(source.substring(with: range)) }
    }

    /// Named capture groups declared by the pattern, ignoring escaped text,
    /// \Q...\E quotes and character classes.
    static func groupNames(in pattern: String) -> Set<String> {
        let chars = Array(pattern.utf16)
        var names = Set<String>()
        var classDepth = 0
        var index = 0
        while index < chars.count {
            let char = chars[index]
            if char == 92 { // backslash
                if index + 1 < chars.count && chars[index + 1] == 81 { // Q
                    guard let end = quoteEnd(chars, from: index + 2) else { return names }
                    index = end + 1
                } else {
                    index += 1
                }
            } else if classDepth > 0 {
                if char == 91 { classDepth += 1 } else if char == 93 { classDepth -= 1 }
            } else if char == 91 { // [
                classDepth = 1
                if index + 1 < chars.count && chars[index + 1] == 94 { index += 1 }
                if index + 1 < chars.count && chars[index + 1] == 93 { index += 1 }
            } else if char == 40, index + 3 < chars.count, chars[index + 1] == 63, chars[index + 2] == 60, isLetter(chars[index + 3]) {
                var end = index + 3
                while end < chars.count && chars[end] != 62 { end += 1 }
                names.insert(String(decoding: chars[(index + 3)..<end], as: UTF16.self))
                index = end
            }
            index += 1
        }
        return names
    }

    private static func quoteEnd(_ chars: [UInt16], from start: Int) -> Int? {
        var index = start
        while index + 1 < chars.count {
            if chars[index] == 92 && chars[index + 1] == 69 { return index }
            index += 1
        }
        return nil
    }

    private static func isLetter(_ char: UInt16) -> Bool {
        (65...90).contains(char) || (97...122).contains(char)
    }
}
