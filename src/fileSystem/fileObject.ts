/**
 * Represents a virtual file or directory that can be backed by any type of storage,
 * such as a local filesystem, remote server, or sandboxed virtual environment.
 */

export interface FileObject {
    /**
     * Lists all files and directories within this directory.
     * @returns A promise resolving to an array of child `FileObject`s.
     * @throws If the current object is not a directory.
     */
    listFiles(): Promise<FileObject[]>;

    /**
     * Checks if this object represents a directory.
     * @returns A promise resolving to `true` if it's a directory, otherwise `false`.
     */
    isDirectory(): Promise<boolean>;

    /**
     * Checks if this object represents a regular file.
     * @returns A promise resolving to `true` if it's a file, otherwise `false`.
     */
    isFile(): Promise<boolean>;

    /**
     * Checks if this object represents a symbolic link or alias.
     * @returns A promise resolving to `true` if it's a link, otherwise `false`.
     */
    isLink(): Promise<boolean>;

    /**
     * Gets the name of this file or directory (not the full path).
     * @returns The name as a string.
     */
    getName(): Promise<string>

    /**
     * Checks whether the file or directory is readable.
     * @returns A promise resolving to `true` if it can be read, otherwise `false`.
     */
    canRead(): Promise<boolean>;

    /**
     * Checks whether the file or directory is writable.
     * @returns A promise resolving to `true` if it can be written to, otherwise `false`.
     */
    canWrite(): Promise<boolean>;

    /**
     * Determines if this file is backed by the native filesystem and
     * can be accessed using `java.io.File` or similar APIs.
     * @returns A promise resolving to `true` if it’s a native file.
     */
    isNative(): Promise<boolean>;

    /**
     * Determines whether the file path uses a Unix-style format (forward slashes, starting with `/`).
     * @returns A promise resolving to `true` if the path is Unix-like.
     */
    isUnixLike(): Promise<boolean>;

    /**
     * Gets the file size in bytes.
     * @returns A promise resolving to the file’s size.
     */
    getLength(): Promise<number>;

    /**
     * Checks whether this file or directory exists.
     * @returns A promise resolving to `true` if it exists, otherwise `false`.
     */
    exists(): Promise<boolean>;

    /**
     * Creates a new empty file at this path.
     * @returns A promise resolving to `true` if the file was created, `false` if it already exists.
     */
    createNewFile(): Promise<boolean>;

    /**
     * Creates this directory (non-recursively).
     * Fails if the parent directory does not exist.
     * @returns A promise resolving to `true` if created successfully.
     */
    mkdir(): Promise<boolean>;

    /**
     * Creates this directory and all missing parent directories if necessary.
     * @returns A promise resolving to `true` if created successfully.
     */
    mkdirs(): Promise<boolean>;

    /**
     * Writes text content to this file.
     * @param text The text to write.
     * @param encoding Optional text encoding (e.g., `"utf-8"`). Defaults to UTF-8.
     */
    writeText(text: string, encoding?: string): Promise<void>;

    /**
     * Reads the entire content of this file as text.
     * @param encoding Optional text encoding (e.g., `"utf-8"`). Defaults to UTF-8.
     * @returns A promise resolving to the file’s text content.
     */
    readText(encoding?: string): Promise<string>;

    /**
     * Deletes this file or directory.
     * @returns A promise resolving to `true` if deleted successfully, otherwise `false`.
     */
    delete(): Promise<boolean>;

    /**
     * Returns a URI representation of this file (e.g., `file://`, `content://`, or custom scheme).
     * @returns A promise resolving to the file’s URI string.
     */
    toUri(): Promise<string>;

    /**
     * Checks whether a child with the given name exists inside this directory.
     * @param name The name of the child file or directory.
     * @returns A promise resolving to `true` if it exists, `false` if not, or `null` if unknown.
     */
    childByNameExists(name: string): Promise<boolean | null>;

    /**
     * Gets a `FileObject` representing a child entry with the given name.
     * The child may or may not exist yet.
     * @param name The name of the child.
     * @returns A promise resolving to a `FileObject`, or `null` if the child is impossible
     */
    getChildByName(name: string): Promise<FileObject | null>;

    /**
     * Returns the parent directory of this file.
     * @returns A promise resolving to the parent `FileObject`, or `null` if there’s no parent.
     * @throws If unable to determine the parent.
     */
    getParentFile(): Promise<FileObject | null>;
}
