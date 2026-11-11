//! Bounded local Library Rules schema validation (Stage 1B1).
//! The evaluator is opt-in and read-only; no Tauri command or background work.
//! Frontend validation is not a security boundary; validate again in Rust.

pub mod evaluator;

use serde::{Deserialize, Deserializer, Serialize};

use crate::dto::LibraryScopePair;
use crate::store::LibraryStore;

/// Maximum request JSON bytes allowed before invoking the recursive JSON decoder.
/// The actual AST is also constrained to 64 nodes / depth 5 by its validator.
pub const MAX_RULE_JSON_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuleEvaluateRequest {
    pub scopes: Vec<LibraryScopePair>,
    pub rule_json: String,
    pub limit: u32,
    pub offset: u32,
}

/// Strictly on-demand service entry point. Only obtains a dedicated heavy-query
/// SQLite reader after cheap input checks. No server I/O, writes or sync activity.
pub fn run(
    store: &LibraryStore,
    request: &RuleEvaluateRequest,
) -> Result<evaluator::RulePage, String> {
    let document = validate_evaluate_request(request)?;
    // The store helper expects rusqlite::Result<R>; R is the evaluator's
    // Result<RulePage, String>. Returning that as a value preserves useful
    // validation/SQL diagnostics without turning them into SQLite errors.
    store.with_scope_detail_read_conn(|conn| {
        Ok(evaluator::evaluate_page(
            conn,
            &document,
            &request.scopes,
            request.limit,
            request.offset,
        ))
    })?
}

fn validate_evaluate_request(request: &RuleEvaluateRequest) -> Result<RuleDocument, String> {
    if request.rule_json.len() > MAX_RULE_JSON_BYTES {
        return Err("Library Rules document is too large".to_string());
    }
    if request.limit == 0 || request.limit > evaluator::MAX_RULE_PAGE_SIZE {
        return Err("Library Rules page limit must be between 1 and 200".to_string());
    }
    if request.scopes.is_empty() || request.scopes.len() > 150 {
        return Err("Select 1–150 library scopes before running a rule".to_string());
    }
    parse_rule_document(&request.rule_json)
}

pub const LIBRARY_RULE_VERSION: u16 = 1;
pub const MAX_LIBRARY_RULE_NODES: usize = 64;
pub const MAX_LIBRARY_RULE_DEPTH: usize = 5;
const MAX_TEXT_UTF16_UNITS: usize = 4096;
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuleEntity {
    Album,
    Track,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuleCombinator {
    All,
    Any,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuleOperator {
    Is,
    IsNot,
    Contains,
    NotContains,
    StartsWith,
    EndsWith,
    GreaterThan,
    AtLeast,
    LessThan,
    AtMost,
    IsPresent,
    IsMissing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RuleValue {
    Text(String),
    Integer(i64),
    Boolean(bool),
}

// Without this custom deserializer, serde Option<T> silently treats both
// absent JSON properties and explicit null as None, unlike the TS contract.
fn present_rule_value<'de, D>(deserializer: D) -> Result<Option<RuleValue>, D::Error>
where
    D: Deserializer<'de>,
{
    RuleValue::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum RuleNode {
    Group {
        combinator: RuleCombinator,
        children: Vec<RuleNode>,
    },
    Predicate {
        field: String,
        operator: RuleOperator,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "present_rule_value"
        )]
        value: Option<RuleValue>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuleDocument {
    pub version: u16,
    pub entity: RuleEntity,
    pub root: RuleNode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuleFieldType {
    Text,
    Number,
    Boolean,
    Coverage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RuleField {
    pub kind: RuleFieldType,
    pub nullable: bool,
}

// Literal backend whitelist, independent of the UI. A future SQL compiler
// must use only literal column expressions for these names.
pub fn rule_field(entity: RuleEntity, field: &str) -> Option<RuleField> {
    use RuleEntity::{Album, Track};
    use RuleFieldType::{Boolean, Coverage, Number, Text};
    let (kind, nullable) = match (entity, field) {
        (Album, "albumName" | "albumArtist") => (Text, true),
        (Album, "albumYear") => (Number, true),
        (Album, "trackCount" | "genreMissingTracks" | "moodMissingTracks") => (Number, false),
        (Album, "genreStatus" | "moodStatus") => (Coverage, false),
        (Album, "albumGenrePresent") => (Boolean, false),
        (Track, "trackTitle") => (Text, false),
        (Track, "trackArtist" | "albumName") => (Text, true),
        (Track, "trackYear" | "bitRate" | "playCount") => (Number, true),
        (Track, "durationSeconds") => (Number, false),
        (Track, "genrePresent" | "moodPresent") => (Boolean, false),
        _ => return None,
    };
    Some(RuleField { kind, nullable })
}

pub fn operator_supported(field: RuleField, op: RuleOperator) -> bool {
    use RuleFieldType::{Boolean, Coverage, Number, Text};
    use RuleOperator::{
        AtLeast, AtMost, Contains, EndsWith, GreaterThan, Is, IsMissing, IsNot, IsPresent,
        LessThan, NotContains, StartsWith,
    };
    if matches!(field.kind, Boolean | Coverage) {
        return matches!(op, Is | IsNot);
    }
    match op {
        Is | IsNot => true,
        Contains | NotContains | StartsWith | EndsWith => field.kind == Text,
        GreaterThan | AtLeast | LessThan | AtMost => field.kind == Number,
        IsPresent | IsMissing => field.nullable,
    }
}

fn valid_value(value: &RuleValue, field: RuleFieldType) -> bool {
    match (field, value) {
        (RuleFieldType::Text, RuleValue::Text(text)) => {
            !text.trim().is_empty() && text.encode_utf16().count() <= MAX_TEXT_UTF16_UNITS
        }
        (RuleFieldType::Coverage, RuleValue::Text(text)) => {
            matches!(text.as_str(), "complete" | "partial" | "missing")
        }
        (RuleFieldType::Number, RuleValue::Integer(number)) => {
            (-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(number)
        }
        (RuleFieldType::Boolean, RuleValue::Boolean(_)) => true,
        _ => false,
    }
}

pub fn validate_rule_document(doc: &RuleDocument) -> Result<(), String> {
    if doc.version != LIBRARY_RULE_VERSION {
        return Err(format!("Unsupported Library Rules version {}", doc.version));
    }
    if !matches!(doc.root, RuleNode::Group { .. }) {
        return Err("Library Rules root must be an ALL/ANY group".to_string());
    }
    let mut count = 0usize;
    validate_node(&doc.root, doc.entity, 1, &mut count, "/root")
}

fn validate_node(
    node: &RuleNode,
    entity: RuleEntity,
    depth: usize,
    count: &mut usize,
    path: &str,
) -> Result<(), String> {
    *count += 1;
    if *count > MAX_LIBRARY_RULE_NODES {
        return Err(format!("{path}: too many nodes"));
    }
    if depth > MAX_LIBRARY_RULE_DEPTH {
        return Err(format!("{path}: nesting exceeds the allowed depth"));
    }
    match node {
        RuleNode::Group { children, .. } => {
            if children.is_empty() {
                return Err(format!("{path}: empty group"));
            }
            for (index, child) in children.iter().enumerate() {
                validate_node(
                    child,
                    entity,
                    depth + 1,
                    count,
                    &format!("{path}/children/{index}"),
                )?;
            }
        }
        RuleNode::Predicate {
            field,
            operator,
            value,
        } => {
            let spec = rule_field(entity, field)
                .ok_or_else(|| format!("{path}: unknown field {field}"))?;
            if !operator_supported(spec, *operator) {
                return Err(format!("{path}: operator not supported for {field}"));
            }
            if matches!(operator, RuleOperator::IsPresent | RuleOperator::IsMissing) {
                if value.is_some() {
                    return Err(format!("{path}: presence operator takes no value"));
                }
            } else {
                let bound = value
                    .as_ref()
                    .ok_or_else(|| format!("{path}: value is required"))?;
                if !valid_value(bound, spec.kind) {
                    return Err(format!("{path}: invalid value for {field}"));
                }
            }
        }
    }
    Ok(())
}

pub fn parse_rule_document(json: &str) -> Result<RuleDocument, String> {
    let doc: RuleDocument = serde_json::from_str(json)
        .map_err(|error| format!("Invalid Library Rules JSON: {error}"))?;
    validate_rule_document(&doc)?;
    Ok(doc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn album_preset() -> Value {
        json!({
            "version": 1, "entity": "album",
            "root": { "kind": "group", "combinator": "any", "children": [
                { "kind": "predicate", "field": "genreStatus",
                  "operator": "isNot", "value": "complete" },
                { "kind": "predicate", "field": "moodStatus",
                  "operator": "isNot", "value": "complete" }
            ]}
        })
    }
    fn parse(input: &Value) -> Result<RuleDocument, String> {
        parse_rule_document(&input.to_string())
    }

    #[test]
    fn album_and_track_presets_roundtrip() {
        let preset = album_preset();
        assert_eq!(
            serde_json::to_value(parse(&preset).unwrap()).unwrap(),
            preset
        );
        let track = json!({
            "version": 1, "entity": "track",
            "root": { "kind": "group", "combinator": "any", "children": [
                { "kind": "predicate", "field": "genrePresent",
                  "operator": "is", "value": false },
                { "kind": "predicate", "field": "moodPresent",
                  "operator": "is", "value": false }
            ]}
        });
        assert_eq!(serde_json::to_value(parse(&track).unwrap()).unwrap(), track);
    }

    #[test]
    fn nested_mixed_type_predicates_are_valid() {
        let rule = json!({
            "version": 1, "entity": "album",
            "root": { "kind": "group", "combinator": "all", "children": [
                { "kind": "predicate", "field": "trackCount",
                  "operator": "atLeast", "value": 5 },
                { "kind": "group", "combinator": "any", "children": [
                    { "kind": "predicate", "field": "genreStatus",
                      "operator": "is", "value": "partial" },
                    { "kind": "predicate", "field": "albumYear",
                      "operator": "isMissing" },
                    { "kind": "predicate", "field": "albumName",
                      "operator": "contains", "value": "Live" }
                ]}
            ]}
        });
        assert!(parse(&rule).is_ok());
    }

    #[test]
    fn unknown_fields_and_extra_properties_are_rejected() {
        let mut rule = album_preset();
        rule["extra"] = json!("unexpected");
        assert!(parse(&rule).is_err());
        let mut rule = album_preset();
        rule["root"]["children"][0]["sql"] = json!("1=1");
        assert!(parse(&rule).is_err());
        let mut rule = album_preset();
        rule["root"]["children"][0]["field"] = json!("trackTitle");
        assert!(parse(&rule).is_err());
        let mut rule = album_preset();
        rule["root"]["children"][0]["field"] = json!("__proto__");
        assert!(parse(&rule).is_err());
    }

    #[test]
    fn invalid_typed_values_and_null_are_rejected() {
        let mut rule = album_preset();
        rule["root"]["children"][0]["value"] = json!(false);
        assert!(parse(&rule).is_err());
        rule["root"]["children"][0]["value"] = Value::Null;
        assert!(parse(&rule).is_err());
        let mut rule = album_preset();
        rule["root"]["children"][0]
            .as_object_mut()
            .unwrap()
            .remove("value");
        assert!(parse(&rule).is_err());
        let mut rule = album_preset();
        rule["root"]["children"][0]["operator"] = json!("contains");
        assert!(parse(&rule).is_err());
    }

    #[test]
    fn wrong_version_empty_group_and_bad_root_are_rejected() {
        let mut rule = album_preset();
        rule["version"] = json!(2);
        assert!(parse(&rule).is_err());
        let mut rule = album_preset();
        rule["root"]["children"] = json!([]);
        assert!(parse(&rule).is_err());
        let mut rule = album_preset();
        rule["root"] = json!({
            "kind": "predicate", "field": "trackCount",
            "operator": "atLeast", "value": 3
        });
        assert!(parse(&rule).is_err());
    }

    #[test]
    fn node_and_depth_limits_are_enforced() {
        let mut rule = album_preset();
        rule["root"]["children"] = Value::Array(
            (0..MAX_LIBRARY_RULE_NODES)
                .map(|_| {
                    json!({
                        "kind": "predicate", "field": "albumName", "operator": "isPresent"
                    })
                })
                .collect(),
        );
        assert!(parse(&rule).unwrap_err().contains("too many"));
        let mut node = json!({
            "kind": "predicate", "field": "albumName", "operator": "isPresent"
        });
        for _ in 0..MAX_LIBRARY_RULE_DEPTH {
            node = json!({ "kind": "group", "combinator": "all", "children": [node] });
        }
        let mut rule = album_preset();
        rule["root"] = node;
        assert!(parse(&rule).unwrap_err().contains("nesting exceeds"));
    }

    #[test]
    fn safe_integers_and_presence_operators_are_enforced() {
        let mut rule = album_preset();
        rule["root"]["children"][0] = json!({
            "kind": "predicate", "field": "trackCount",
            "operator": "atLeast", "value": 9_007_199_254_740_992_i64
        });
        assert!(parse(&rule).is_err());
        rule["root"]["children"][0]["value"] = json!(5.5);
        assert!(parse(&rule).is_err());
        rule["root"]["children"][0]["value"] = json!(5);
        assert!(parse(&rule).is_ok());
        rule["root"]["children"][0] = json!({
            "kind": "predicate", "field": "albumYear", "operator": "isMissing"
        });
        assert!(parse(&rule).is_ok());
        rule["root"]["children"][0]["value"] = json!(0);
        assert!(parse(&rule).is_err());
    }

    #[test]
    fn evaluation_request_checks_limits_before_query_execution() {
        let preset = album_preset().to_string();
        let mut request = RuleEvaluateRequest {
            scopes: vec![LibraryScopePair {
                server_id: "s1".to_string(),
                library_id: None,
            }],
            rule_json: preset.clone(),
            limit: 50,
            offset: 0,
        };
        assert!(validate_evaluate_request(&request).is_ok());
        request.limit = 0;
        assert!(validate_evaluate_request(&request).is_err());
        request.limit = evaluator::MAX_RULE_PAGE_SIZE + 1;
        assert!(validate_evaluate_request(&request).is_err());
        request.limit = 50;
        request.scopes.clear();
        assert!(validate_evaluate_request(&request).is_err());
        request.scopes = (0..151)
            .map(|n| LibraryScopePair {
                server_id: format!("s{n}"),
                library_id: None,
            })
            .collect();
        assert!(validate_evaluate_request(&request).is_err());
        request.scopes.truncate(1);
        request.rule_json = "x".repeat(MAX_RULE_JSON_BYTES + 1);
        assert!(validate_evaluate_request(&request).is_err());
        request.rule_json = preset;
        assert!(validate_evaluate_request(&request).is_ok());
    }

    #[test]
    fn evaluation_request_rejects_untrusted_json_and_unknown_keys() {
        let request = RuleEvaluateRequest {
            scopes: vec![LibraryScopePair {
                server_id: "s1".to_string(),
                library_id: None,
            }],
            rule_json: "{\"version\": 1, \"entity\": \"album\", \"root\": null}".to_string(),
            limit: 50,
            offset: 0,
        };
        assert!(validate_evaluate_request(&request).is_err());
        let unknown = serde_json::json!({
            "scopes": [{"serverId": "s1", "libraryId": null}],
            "ruleJson": album_preset().to_string(),
            "limit": 50,
            "offset": 0,
            "sql": "DELETE FROM track",
        });
        assert!(serde_json::from_value::<RuleEvaluateRequest>(unknown).is_err());
    }

    #[test]
    fn blank_and_too_long_strings_are_rejected() {
        let mut rule = album_preset();
        rule["root"]["children"][0] = json!({
            "kind": "predicate", "field": "albumName",
            "operator": "contains", "value": " "
        });
        assert!(parse(&rule).is_err());
        rule["root"]["children"][0]["value"] = json!("x".repeat(4097));
        assert!(parse(&rule).is_err());
        rule["root"]["children"][0]["value"] = json!("Jazz");
        assert!(parse(&rule).is_ok());
    }
}
