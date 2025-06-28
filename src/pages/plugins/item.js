import helpers from "utils/helpers";

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
          <img src={icon || "./res/puzzle.png"} alt={name + " icon"} />
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
          {/* Enable/Disable Toggle */}
          {installed && (
            <span
              className="plugin-toggle-switch"
              data-enabled={enabled}
              // style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',  zIndex: 100 }}
              onclick={e => {
                e.stopPropagation();
                onToggleEnabled?.(id, enabled);
              }}
            >
              <span
                className="plugin-toggle-track"
                data-enabled={enabled}
                // style={{
                //   width: 36,
                //   height: 20,
                //   borderRadius: 12,
                //   background: enabled ? '#4ade80' : '#d1d5db',
                //   position: 'relative',
                //   transition: 'background 0.2s',
                //   display: 'inline-block',
                // }}
              >
                <span
                  className="plugin-toggle-thumb"
                  // style={{
                  //   position: 'absolute',
                  //   left: enabled ? 18 : 2,
                  //   top: 2,
                  //   width: 16,
                  //   height: 16,
                  //   borderRadius: '50%',
                  //   background: '#fff',
                  //   boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                  //   transition: 'left 0.2s',
                  // }}
                />
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
