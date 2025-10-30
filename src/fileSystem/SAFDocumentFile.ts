// @ts-ignore
import loader from "dialogs/loader";
// @ts-ignore
import { decode, encode } from "utils/encodings";
// @ts-ignore
import helpers from "utils/helpers";
// @ts-ignore
import Url from "utils/Url";


import { FileObject } from "./fileObject";

declare const sdcard: any;

//alternative for externalFs.js
export class SAFDocumentFile implements FileObject {
    constructor(private uri: string) {}

    async canRead(): Promise<boolean> {
        const stat = await this.stat();
        return !!stat.canRead;
    }

    async canWrite(): Promise<boolean> {
        const stat = await this.stat();
        return !!stat.canWrite;
    }

    async childByNameExists(name: string): Promise<boolean> {
        const children = await this.listFiles();
        return children.some(c => c.getName().then(n => n === name));
    }

    async createNewFile(): Promise<boolean> {
        try {
            await this.writeText("");
            return true;
        } catch {
            return false;
        }
    }

    async delete(): Promise<boolean> {
        return new Promise((resolve, reject) => {
            sdcard.delete(this.uri, () => resolve(true), reject);
        });
    }

    async exists(): Promise<boolean> {
        try {
            await this.stat();
            return true;
        } catch {
            return false;
        }
    }

    async getChildByName(name: string): Promise<FileObject | null> {
        const children = await this.listFiles();
        for (const child of children) {
            if (await child.getName() === name) return child;
        }
        return null;
    }

    async getLength(): Promise<number> {
        const stat = await this.stat();
        return stat.size ?? 0;
    }

    async getName(): Promise<string> {
        const parts = this.uri.split("/");
        return parts[parts.length - 1] || "";
    }

    async getParentFile(): Promise<FileObject | null> {
        const parent = Url.dirname(this.uri);
        if (!parent || parent === this.uri) return null;
        return new SAFDocumentFile(parent);
    }

    async isDirectory(): Promise<boolean> {
        const stat = await this.stat();
        return stat.isDirectory === true;
    }

    async isFile(): Promise<boolean> {
        const stat = await this.stat();
        return stat.isFile === true;
    }

    async isLink(): Promise<boolean> {
        return false;
    }

    async isNative(): Promise<boolean> {
        return true;
    }

    async isUnixLike(): Promise<boolean> {
        return false;
    }

    async listFiles(): Promise<FileObject[]> {
        const uri = await this.formatUri(this.uri);
        return new Promise((resolve, reject) => {
            sdcard.listDir(
                uri,
                (entries: any[]) => {
                    const files = entries.map((e) => new SAFDocumentFile(e.url || e.uri));
                    resolve(files);
                },
                reject,
            );
        });
    }

    async mkdir(): Promise<boolean> {
        const parent = await this.getParentFile();
        if (!parent) return false;
        return new Promise((resolve, reject) => {
            // @ts-ignore
            sdcard.createDir(parent.uri, this.getName(), () => resolve(true), reject);
        });
    }

    async mkdirs(): Promise<boolean> {
        // Simplified version that only creates one level
        return this.mkdir();
    }

    async readText(encoding = "utf8"): Promise<string> {
        const uri = await this.formatUri(this.uri);
        return new Promise((resolve, reject) => {
            sdcard.read(
                uri,
                async (data: ArrayBuffer) => {
                    const text = await decode(data, encoding);
                    resolve(text);
                },
                reject,
            );
        });
    }

    async writeText(text: string, encoding = "utf8"): Promise<void> {
        const encoded = await encode(text, encoding);
        return new Promise((resolve, reject) => {
            sdcard.write(this.uri, encoded, resolve, reject);
        });
    }

    async toUri(): Promise<string> {
        return this.uri;
    }

    // ---- Extra helpers translated from externalFs ----

    private async formatUri(uri: string): Promise<string> {
        return new Promise((resolve, reject) => {
            sdcard.formatUri(uri, resolve, reject);
        });
    }

    private async stat(): Promise<any> {
        const storageList = helpers.parseJSON(localStorage.getItem("storageList"));

        if (Array.isArray(storageList)) {
            const storage = storageList.find((s) => s.uri === this.uri);
            if (storage) {
                const stat = {
                    size: 0,
                    name: storage.name,
                    type: "dir",
                    canRead: true,
                    canWrite: true,
                    modifiedDate: new Date(),
                    isDirectory: true,
                    isFile: false,
                    url: this.uri,
                };

                helpers.defineDeprecatedProperty(
                    stat,
                    "uri",
                    function () {
                        // @ts-ignore
                        return this.url;
                    },
                    function (value:any) {
                        // @ts-ignore
                        this.url = value;
                    },
                );

                return stat;
            }
        }

        const uri = await this.formatUri(this.uri);
        return new Promise((resolve, reject) => {
            sdcard.stats(
                uri,
                (stats: any) => {
                    helpers.defineDeprecatedProperty(
                        stats,
                        "uri",
                        function () {
                            // @ts-ignore
                            return this.url;
                        },
                        function (val:any) {
                            // @ts-ignore
                            this.url = val;
                        },
                    );
                    resolve(stats);
                },
                reject,
            );
        });
    }

    // ---- Optional static helpers for mount management ----

    static async listStorages(): Promise<any[]> {
        return new Promise((resolve, reject) => {
            sdcard.listStorages(resolve, reject);
        });
    }

    static async getStorageAccessPermission(uuid: string, name: string): Promise<void> {
        return new Promise((resolve, reject) => {
            setTimeout(() => loader.destroy(), 100);
            sdcard.getStorageAccessPermission(uuid, resolve, reject);
        });
    }

    static test(url: string): boolean {
        return /^content:/.test(url);
    }
}
