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
}) {
  console.log(`ICON ${icon}`)
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
      className="list-item"
      data-action="open"
      data-installed={(!!installed).toString()}
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
        </div>
      </div>
    </div>
  );
}
