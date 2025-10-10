import {FileObject} from "./fileObject";

declare var cordova: any;

declare global {
    interface Window {
        NativeFileWrapper: typeof NativeFileWrapper;
    }
}

export class NativeFileWrapper implements FileObject {
    private readonly path: string;

    constructor(absolutePath: string) {
        this.path = absolutePath;
    }

    private execPlugin(action: string, args: any[] = []): Promise<any> {
        return new Promise((resolve, reject) => {
            cordova.exec(
                (result: any) => resolve(result),
                (error: any) => reject(error),
                'nativeFile',
                action,
                [this.path, ...args]
            );
        });
    }

    async canRead(): Promise<boolean> {
        const result = await this.execPlugin('canRead');
        return result === 1;
    }

    async canWrite(): Promise<boolean> {
        const result = await this.execPlugin('canWrite');
        return result === 1;
    }

    async childByNameExists(name: string): Promise<boolean | null> {
        try {
            const result = await this.execPlugin('childByNameExists', [name]);
            return result === 1;
        } catch (error) {
            return null;
        }
    }

    async createNewFile(): Promise<boolean> {
        try {
            const result = await this.execPlugin('createNewFile');
            return result === 1;
        } catch (error) {
            return false;
        }
    }

    async delete(): Promise<boolean> {
        try {
            const result = await this.execPlugin('delete');
            return result === 1;
        } catch (error) {
            return false;
        }
    }

    async exists(): Promise<boolean> {
        try {
            const result = await this.execPlugin('exists');
            return result === 1;
        } catch (error) {
            return false;
        }
    }

    async getChildByName(name: string): Promise<FileObject | null> {
        try {
            const childPath = await this.execPlugin('getChildByName', [name]);
            if (childPath && childPath !== "") {
                return new NativeFileWrapper(childPath);
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    async getLength(): Promise<number> {
        try {
            return await this.execPlugin('getLength');
        } catch (error) {
            return 0;
        }
    }

    async getName(): Promise<string> {
        try {
            return await this.execPlugin('getName');
        } catch (error) {
            throw new Error(`Failed to read file name: ${error}`);
        }
    }

    async getParentFile(): Promise<FileObject | null> {
        try {
            const parentPath = await this.execPlugin('getParentFile');
            if (parentPath && parentPath !== "") {
                return new NativeFileWrapper(parentPath);
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    async isDirectory(): Promise<boolean> {
        try {
            const result = await this.execPlugin('isDirectory');
            return result === 1;
        } catch (error) {
            return false;
        }
    }

    async isFile(): Promise<boolean> {
        try {
            const result = await this.execPlugin('isFile');
            return result === 1;
        } catch (error) {
            return false;
        }
    }

    async isLink(): Promise<boolean> {
        try {
            const result = await this.execPlugin('isLink');
            return result === 1;
        } catch (error) {
            return false;
        }
    }

    async isNative(): Promise<boolean> {
        try {
            const result = await this.execPlugin('isNative');
            return result === 1;
        } catch (error) {
            return true; // Default to true for native implementation
        }
    }

    async isUnixLike(): Promise<boolean> {
        try {
            const result = await this.execPlugin('isUnixLike');
            return result === 1;
        } catch (error) {
            return true; // Default to true for Android
        }
    }

    async listFiles(): Promise<FileObject[]> {
        try {
            const paths: string[] = await this.execPlugin('listFiles');
            return paths.map(path => new NativeFileWrapper(path));
        } catch (error) {
            return [];
        }
    }

    async mkdir(): Promise<boolean> {
        try {
            const result = await this.execPlugin('mkdir');
            return result === 1;
        } catch (error) {
            return false;
        }
    }

    async mkdirs(): Promise<boolean> {
        try {
            const result = await this.execPlugin('mkdirs');
            return result === 1;
        } catch (error) {
            return false;
        }
    }

    async readText(encoding: string = "UTF-8"): Promise<string> {
        try {
            return await this.execPlugin('readText', [encoding]);
        } catch (error) {
            throw new Error(`Failed to read file: ${error}`);
        }
    }

    async toUri(): Promise<string> {
        try {
            return await this.execPlugin('toUri');
        } catch (error) {
            return `file://${this.path}`;
        }
    }

    async writeText(text: string, encoding: string = "UTF-8"): Promise<void> {
        try {
            await this.execPlugin('writeText', [text, encoding]);
        } catch (error) {
            throw new Error(`Failed to write file: ${error}`);
        }
    }

    // Utility method to get the absolute path
    getPath(): string {
        return this.path;
    }
}