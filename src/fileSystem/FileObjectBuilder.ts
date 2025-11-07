import {FileObject} from "./fileObject";
import {NativeFileWrapper} from "./NativeFileWrapper";
import {SAFDocumentFile} from "./SAFDocumentFile";

export class FileObjectBuilder {
    async build(uri: string): Promise<FileObject | null> {
        if (uri.startsWith("file://") || uri.startsWith("cdvfile://")) {
            return new Promise<FileObject | null>((resolve, reject) => {
                const wrapper = new NativeFileWrapper(uri, (nativeFile) => {
                    resolve(nativeFile);
                });

                // Catch errors from the async ready promise
                wrapper.ready.catch(reject);
            });
        }
        if (uri.startsWith("content://")) {
            return new SAFDocumentFile(uri);
        }
        return null;
    }
}
