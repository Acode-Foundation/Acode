import helpers from "utils/helpers";
import pluginIcon from './plugin-icon.png';

/**
 * Creates a plugin list item
 * @param {object} param0
 * @param {string} [param0.id]
 * @param {string} [param0.name]
 * @param {string} [param0.icon]
 * @param {string} [param0.version]
 * @param {number} [param0.downloads]
 * @param {boolean} [param0.installed]
 * @param {boolean} [param0.enabled]
 * @param {function} [param0.onToggleEnabled]
 * @returns
 */
export default function Item({
  id,
  name,
  icon,
  version,
  license,
  author,
  price,
  author_verified,
  downloads,
  installed,
  enabled,
  onToggleEnabled,
  updates,
}) {
  const authorName = (() => {
    const displayName =
      typeof author === "object" ? author.name : author || "Unknown";
    // Check if it's likely an email or too long
    if (displayName.includes("@") || displayName.length > 20) {
      return displayName.substring(0, 20) + "...";
    }
    return displayName;
  })();

  return (
    <div
      data-id={id}
      data-plugin-enabled={enabled !== false}
      className="list-item"
      data-action="open"
      data-installed={(!!installed).toString()}
      style={enabled === false ? { opacity: 0.6 } : {}}
    >
      <div className="plugin-header">
        <div className="plugin-icon">
          <img src={icon || pluginIcon} alt={name + " icon"} />
        </div>
        <div className="plugin-info">
          <div className="plugin-main">
            <div className="plugin-title">
              <span className="plugin-name" title={name}>
                {name}
              </span>
              <span className="plugin-version">v{version}</span>
            </div>
            <div className="plugin-meta">
              <div
                className="plugin-stats plugin-author"
                title={
                  typeof author === "object" ? author.name : author || "Unknown"
                }
              >
                <span className="icon person"></span>
                {authorName}
                {author_verified ? (
                  <i
                    className="licons verified"
                    style={{ color: "#3b82f6" }}
                  ></i>
                ) : (
                  ""
                )}
              </div>
              <span className="plugin-meta-dot"></span>
              <div className="plugin-stats">
                <span
                  className="licons scale"
                  style={{ fontSize: "12px" }}
                ></span>
                {license || "Unknown"}
              </div>
              {downloads && (
                <>
                  <span className="plugin-meta-dot"></span>
                  <div className="plugin-stats">
                    <span className="icon save_alt"></span>
                    {helpers.formatDownloadCount(downloads)}
                  </div>
                </>
              )}
            </div>
          </div>
          {price !== null && price !== undefined && price !== 0 ? (
            <span className="plugin-price">₹{price}</span>
          ) : null}
          {installed && !updates ? (
            <span
              className="plugin-toggle-switch"
              data-enabled={enabled}
              onclick={e => {
                e.stopPropagation();
                onToggleEnabled?.(id, enabled);
              }}
            >
              <span
                className="plugin-toggle-track"
                data-enabled={enabled}
              >
                <span className="plugin-toggle-thumb" />
              </span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
