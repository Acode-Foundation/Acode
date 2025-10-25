import { FileObject } from "./fileObject";

declare var cordova: any;

export class DocumentFileWrapper implements FileObject {
    private readonly uri: string;

    constructor(uri: string) {
        this.uri = uri;
        //console.log(`[DocumentFileWrapper] Created for uri: ${uri}`);
    }

    private execPlugin(action: string, args: any[] = []): Promise<any> {
        //console.log(`[DocumentFileWrapper] execPlugin called: action=${action}, args=${JSON.stringify(args)}`);
        return new Promise((resolve, reject) => {
            cordova.exec(
                (result: any) => {
                    //console.log(`[DocumentFileWrapper] execPlugin success: action=${action}, result=${JSON.stringify(result)}`);
                    resolve(result);
                },
                (error: any) => {
                    console.error(`[DocumentFileWrapper] execPlugin error: action=${action}, error=${JSON.stringify(error)}`);
                    reject(error);
                },
                'nativeFile',
                action,
                [this.uri, ...args]
            );
        });
    }

    async canRead(): Promise<boolean> {
        const result = await this.execPlugin('canRead');
        //console.log(`[canRead] uri=${this.uri}, result=${result}`);
        return result === 1;
    }

    async canWrite(): Promise<boolean> {
        const result = await this.execPlugin('canWrite');
        //console.log(`[canWrite] uri=${this.uri}, result=${result}`);
        return result === 1;
    }

    async childByNameExists(name: string): Promise<boolean | null> {
        try {
            const result = await this.execPlugin('childByNameExists', [name]);
            //console.log(`[childByNameExists] uri=${this.uri}, name=${name}, result=${result}`);
            return result === 1;
        } catch (error) {
            console.error(`[childByNameExists] uri=${this.uri}, name=${name}, error=${error}`);
            return null;
        }
    }

    async createNewFile(): Promise<boolean> {
        try {
            const result = await this.execPlugin('createNewFile');
            //console.log(`[createNewFile] uri=${this.uri}, result=${result}`);
            return result === 1;
        } catch (error) {
            console.error(`[createNewFile] uri=${this.uri}, error=${error}`);
            return false;
        }
    }

    async delete(): Promise<boolean> {
        try {
            const result = await this.execPlugin('delete');
            //console.log(`[delete] uri=${this.uri}, result=${result}`);
            return result === 1;
        } catch (error) {
            console.error(`[delete] uri=${this.uri}, error=${error}`);
            return false;
        }
    }

    async exists(): Promise<boolean> {
        try {
            const result = await this.execPlugin('exists');
            //console.log(`[exists] uri=${this.uri}, result=${result}`);
            return result === 1;
        } catch (error) {
            console.error(`[exists] uri=${this.uri}, error=${error}`);
            return false;
        }
    }

    async getChildByName(name: string): Promise<FileObject | null> {
        try {
            const childPath = await this.execPlugin('getChildByName', [name]);
            //console.log(`[getChildByName] uri=${this.uri}, name=${name}, childPath=${childPath}`);
            if (childPath && childPath !== "") {
                return new DocumentFileWrapper(childPath);
            }
            return null;
        } catch (error) {
            console.error(`[getChildByName] uri=${this.uri}, name=${name}, error=${error}`);
            return null;
        }
    }

    async getLength(): Promise<number> {
        try {
            const result = await this.execPlugin('getLength');
            //console.log(`[getLength] uri=${this.uri}, length=${result}`);
            return result;
        } catch (error) {
            console.error(`[getLength] uri=${this.uri}, error=${error}`);
            return 0;
        }
    }

    async getName(): Promise<string> {
        try {
            const name = await this.execPlugin('getName');
            //console.log(`[getName] uri=${this.uri}, name=${name}`);
            return name;
        } catch (error) {
            console.error(`[getName] uri=${this.uri}, error=${error}`);
            throw new Error(`Failed to read file name: ${error}`);
        }
    }

    async getParentFile(): Promise<FileObject | null> {
        try {
            const parentPath = await this.execPlugin('getParentFile');
            //console.log(`[getParentFile] uri=${this.uri}, parentPath=${parentPath}`);
            if (parentPath && parentPath !== "") {
                return new DocumentFileWrapper(parentPath);
            }
            return null;
        } catch (error) {
            console.error(`[getParentFile] uri=${this.uri}, error=${error}`);
            return null;
        }
    }

    async isDirectory(): Promise<boolean> {
        try {
            const result = await this.execPlugin('isDirectory');
            //console.log(`[isDirectory] uri=${this.uri}, result=${result}`);
            return result === 1;
        } catch (error) {
            console.error(`[isDirectory] uri=${this.uri}, error=${error}`);
            return false;
        }
    }

    async isFile(): Promise<boolean> {
        try {
            const result = await this.execPlugin('isFile');
            //console.log(`[isFile] uri=${this.uri}, result=${result}`);
            return result === 1;
        } catch (error) {
            console.error(`[isFile] uri=${this.uri}, error=${error}`);
            return false;
        }
    }

    async isLink(): Promise<boolean> {
        try {
            const result = await this.execPlugin('isLink');
            //console.log(`[isLink] uri=${this.uri}, result=${result}`);
            return result === 1;
        } catch (error) {
            console.error(`[isLink] uri=${this.uri}, error=${error}`);
            return false;
        }
    }

    async isNative(): Promise<boolean> {
        return false;
    }

    async isUnixLike(): Promise<boolean> {
        return false;
    }

    async listFiles(): Promise<FileObject[]> {
        try {
            const uris: string[] = await this.execPlugin('listFiles');
            //console.log(`[listFiles] uri=${this.uri}, files=${JSON.stringify(uris)}`);
            return uris.map(uri => new DocumentFileWrapper(uri));
        } catch (error) {
            console.error(`[listFiles] uri=${this.uri}, error=${error}`);
            return [];
        }
    }

    async mkdir(): Promise<boolean> {
        try {
            const result = await this.execPlugin('mkdir');
            //console.log(`[mkdir] uri=${this.uri}, result=${result}`);
            return result === 1;
        } catch (error) {
            console.error(`[mkdir] uri=${this.uri}, error=${error}`);
            return false;
        }
    }

    async mkdirs(): Promise<boolean> {
        try {
            const result = await this.execPlugin('mkdirs');
            //console.log(`[mkdirs] uri=${this.uri}, result=${result}`);
            return result === 1;
        } catch (error) {
            console.error(`[mkdirs] uri=${this.uri}, error=${error}`);
            return false;
        }
    }

    async readText(encoding: string = "UTF-8"): Promise<string> {
        try {
            const content = await this.execPlugin('readText', [encoding]);
            //console.log(`[readText] uri=${this.uri}, content length=${content?.length}`);
            return content;
        } catch (error) {
            console.error(`[readText] uri=${this.uri}, error=${error}`);
            throw new Error(`Failed to read file: ${error}`);
        }
    }

    async toUri(): Promise<string> {
        try {
            const uri = await this.execPlugin('toUri');
            //console.log(`[toUri] uri=${this.uri}, uri=${uri}`);
            return uri;
        } catch (error) {
            console.error(`[toUri] uri=${this.uri}, error=${error}`);
            return `file://${this.uri}`;
        }
    }

    async writeText(text: string, encoding: string = "UTF-8"): Promise<void> {
        try {
            await this.execPlugin('writeText', [text, encoding]);
            //console.log(`[writeText] uri=${this.uri}, text length=${text.length}`);
        } catch (error) {
            console.error(`[writeText] uri=${this.uri}, error=${error}`);
            throw new Error(`Failed to write file: ${error}`);
        }
    }

    getPath(): string {
        //console.log(`[getPath] returning uri=${this.uri}`);
        return this.uri;
    }
}
