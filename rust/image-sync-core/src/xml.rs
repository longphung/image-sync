use quick_xml::events::attributes::Attribute;
use quick_xml::events::Event;
use quick_xml::name::QName;
use quick_xml::reader::Reader;
use quick_xml::XmlVersion;

use crate::error::CoreError;

/// True if `name`'s local part (i.e. ignoring any `prefix:`) matches `target`.
pub(crate) fn is_local(name: QName, target: &str) -> bool {
    name.local_name().as_ref() == target.as_bytes()
}

/// Read all text content of the element whose `Start` event was just
/// consumed, up to (and consuming) its matching `End` event.
///
/// This quick-xml version tokenizes entity/character references (`&amp;`,
/// `&lt;`, `&#60;`, ...) as separate `GeneralRef` events rather than folding
/// them into `Text`, so a single `Event::Text` match silently truncates any
/// content containing `&`, `<`, `>`, `"`, or `'`. This walks the full
/// Text/GeneralRef stream and resolves each reference inline.
pub(crate) fn read_element_text(reader: &mut Reader<&[u8]>) -> Result<String, CoreError> {
    let mut buf = String::new();
    loop {
        match reader.read_event().map_err(CoreError::from)? {
            Event::Text(t) => {
                let decoded = t.xml10_content().map_err(quick_xml::Error::from)?;
                buf.push_str(&decoded);
            }
            Event::GeneralRef(r) => {
                if let Some(ch) = r.resolve_char_ref().map_err(CoreError::from)? {
                    buf.push(ch);
                } else if let Ok(name) = r.decode() {
                    if let Some(resolved) = quick_xml::escape::resolve_predefined_entity(&name) {
                        buf.push_str(resolved);
                    }
                }
            }
            Event::End(_) | Event::Eof => break,
            _ => {}
        }
    }
    Ok(buf)
}

/// Decode and unescape an attribute's value.
pub(crate) fn attr_value(attr: &Attribute) -> Result<String, CoreError> {
    let value = attr.normalized_value(XmlVersion::Implicit1_0)?;
    Ok(value.into_owned())
}

/// A second pass of standard-XML-entity unescaping.
///
/// The camera's SOAP `<Result>` element is escaped twice: once for the outer SOAP
/// envelope (undone by quick-xml's normal text unescaping), and a second time because
/// the embedded DIDL-Lite document was itself escaped before being embedded as text
/// (e.g. a literal `<` inside a title survives as `&amp;lt;`, not just `&lt;`, in the
/// raw HTTP body). This undoes that second pass so the result can be parsed as XML.
///
/// `&amp;` must be replaced last: replacing it first would turn `&amp;lt;` into `&lt;`
/// before the `&lt;` → `<` replacement below has had a chance to run on the original
/// (correctly double-escaped) text, corrupting content that only needed one pass.
pub(crate) fn unescape_xml_entities_once(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unescape_resolves_singly_escaped_entities_to_raw_characters() {
        let input = "&lt;tag&gt;text&lt;/tag&gt;";
        assert_eq!(unescape_xml_entities_once(input), "<tag>text</tag>");
    }

    #[test]
    fn unescape_only_removes_one_level_from_doubly_escaped_entities() {
        // "&amp;lt;" is a `<` that has been escaped twice (once as `&lt;`, then
        // that string escaped again as text, turning `&` into `&amp;`). One
        // call should peel off exactly one level, leaving a validly
        // single-escaped `&lt;` rather than cascading all the way to a raw `<`.
        assert_eq!(unescape_xml_entities_once("&amp;lt;"), "&lt;");
    }

    #[test]
    fn amp_replacement_runs_last_so_it_does_not_feed_earlier_replacements() {
        // If `&amp;` were replaced before `&lt;`/`&gt;`, this would incorrectly
        // resolve all the way down to `<b>` in a single pass instead of the
        // correct one-level result `&lt;b&gt;`.
        assert_eq!(unescape_xml_entities_once("&amp;lt;b&amp;gt;"), "&lt;b&gt;");
    }

    #[test]
    fn unescape_is_noop_on_plain_text() {
        assert_eq!(unescape_xml_entities_once("plain text"), "plain text");
    }
}
