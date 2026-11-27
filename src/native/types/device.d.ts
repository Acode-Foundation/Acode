// Type definitions for the native device API
// Definitions by: Microsoft Open Technologies Inc <http://msopentech.com>
//                 Tim Brust <https://github.com/timbru31>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

/**
 * This plugin defines a global device object, which describes the device's hardware and software.
 * Although the object is in the global scope, it is not available until after the deviceready event.
 */
interface Device {
	/** Get the native bridge version. */
	runtimeVersion: string;
	/** Indicates successful native initialization. */
	available: boolean;
	/**
	 * The device.model returns the name of the device's model or product. The value is set
	 * by the device manufacturer and may be different across versions of the same product.
	 */
	model: string;
	/** Get the device's operating system name. */
	platform: string;
	/** Get the device's Universally Unique Identifier (UUID). */
	uuid: string;
	/** Get the operating system version. */
	version: string;
	/** Get the device's manufacturer. */
	manufacturer: string;
	/** Whether the device is running on a simulator. */
	isVirtual: boolean;
	/** Get the device hardware serial number. */
	serial: string;
}

declare const device: Device;
