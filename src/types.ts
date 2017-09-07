import {WriteBuffer, ReadBuffer} from "./buffer";
import {
	Tag,
	posFixintTag, isPosFixintTag, readPosFixint,
	negFixintTag, isNegFixintTag, readNegFixint,
	fixstrTag, isFixstrTag, readFixstr,
	fixarrayTag, isFixarrayTag, readFixarray,
	fixmapTag, isFixmapTag, readFixmap,
} from "./tags";



export interface Type {
	enc(buf: WriteBuffer, v?: any): void;
	dec(buf: ReadBuffer): any;
}



export const Any = {
	enc(buf: WriteBuffer, v: any): void {
		let typ: Type;
		switch(typeof v) {
		case "undefined":
			typ = Nil;
			break;
		case "boolean":
			typ = Bool;
			break;
		case "number":
			typ = !isFinite(v) || Math.floor(v) !== v ? Float
				: v < 0 ? Int
				: Uint;
			break;
		case "string":
			typ = Str;
			break;
		case "object":
			typ = v === null ? Nil
				: Array.isArray(v) ? Arr
				: v instanceof Uint8Array || v instanceof ArrayBuffer ? Bytes
				: Map;
			break;
		default:
			throw new TypeError(`unsupported type ${typeof v}`);
		}
		typ.enc(buf, v);
	},

	dec(buf: ReadBuffer): any {
		const tag = buf.peek();
		let typ: Type;
		switch(tag) {
		case Tag.Nil:
			typ = Nil;
			break;

		case Tag.False:
		case Tag.True:
			typ = Bool;
			break;

		case Tag.Int8:
		case Tag.Int16:
		case Tag.Int32:
		case Tag.Int64:
			typ = Int;
			break;

		case Tag.Uint8:
		case Tag.Uint16:
		case Tag.Uint32:
		case Tag.Uint64:
			typ = Uint;
			break;

		case Tag.Float32:
		case Tag.Float64:
			typ = Float;
			break;

		case Tag.Bin8:
		case Tag.Bin16:
		case Tag.Bin32:
			typ = Bytes;
			break;

		case Tag.Str8:
		case Tag.Str16:
		case Tag.Str32:
			typ = Str;
			break;

		case Tag.Array16:
		case Tag.Array32:
			typ = Arr;
			break;

		case Tag.Map16:
		case Tag.Map32:
			typ = Map;
			break;

		default:
			if(isPosFixintTag(tag) || isNegFixintTag(tag)) {
				typ = Int;
			} else if(isFixstrTag(tag)) {
				typ = Str;
			} else if(isFixarrayTag(tag)) {
				typ = Arr;
			} else if(isFixmapTag(tag)) {
				typ = Map;
			} else {
				throw new TypeError(`unsupported tag ${tag}`);
			}
		}

		return typ.dec(buf);
	},
};


export const Nil = {
	enc(buf: WriteBuffer): void {
		buf.putUi8(Tag.Nil);
	},

	dec(buf: ReadBuffer): any {
		const tag = buf.getUi8();
		if(tag !== Tag.Nil) {
			typeError(tag, "nil");
		}
		return null;
	},
};


export const Bool = {
	enc(buf: WriteBuffer, v: boolean): void {
		buf.putUi8(v ? Tag.True : Tag.False);
	},

	dec(buf: ReadBuffer): boolean {
		const tag = buf.getUi8();
		switch(tag) {
		case Tag.Nil:
		case Tag.False:
			return false;
		case Tag.True:
			return true;
		default:
			typeError(tag, "bool");
		}
	},
};


export const Int = {
	enc(buf: WriteBuffer, v: number): void {
		if(-128 <= v && v <= 127) {
			if(v >= 0) {
				buf.putUi8(posFixintTag(v));
			} else if(v > -32) {
				buf.putUi8(negFixintTag(v));
			} else {
				buf.putUi8(Tag.Int8);
				buf.putUi8(v);
			}
		} else if(-32768 <= v && v <= 32767) {
			buf.putI8(Tag.Int16);
			buf.putI16(v);
		} else if(-2147483648 <= v && v <= 2147483647) {
			buf.putI8(Tag.Int32);
			buf.putI32(v);
		} else {
			buf.putI8(Tag.Int64);
			buf.putI64(v);
		}
	},

	dec(buf: ReadBuffer): number {
		const tag = buf.getUi8();
		if(isPosFixintTag(tag)) {
			return readPosFixint(tag);
		} else if(isNegFixintTag(tag)) {
			return readNegFixint(tag);
		}

		switch(tag) {
		case Tag.Nil:
			return 0;

		// signed int types
		case Tag.Int8:
			return buf.getI8();
		case Tag.Int16:
			return buf.getI16();
		case Tag.Int32:
			return buf.getI32();
		case Tag.Int64:
			return buf.getI64();

		// unsigned int types
		case Tag.Uint8:
			return buf.getUi8();
		case Tag.Uint16:
			return buf.getUi16();
		case Tag.Uint32:
			return buf.getUi32();
		case Tag.Uint64:
			return buf.getUi64();

		default:
			typeError(tag, "int");
		}
	},
};


export const Uint = {
	enc(buf: WriteBuffer, v: number): void {
		if(v < 0) {
			throw new Error(`not an unsigned integer: ${v}`);
		} else if(v <= 127) {
			buf.putUi8(posFixintTag(v));
		} else if(v <= 255) {
			buf.putUi8(Tag.Uint8);
			buf.putUi8(v);
		} else if(v <= 65535) {
			buf.putUi8(Tag.Uint16);
			buf.putUi16(v);
		} else if(v <= 4294967295) {
			buf.putUi8(Tag.Uint32);
			buf.putUi32(v);
		} else {
			buf.putUi8(Tag.Uint64);
			buf.putUi64(v);
		}
	},

	dec(buf: ReadBuffer): number {
		const v = Int.dec(buf);
		if(v < 0) {
			throw new RangeError("unsigned integer underflow");
		}
		return v;
	},
};


export const Float = {
	enc(buf: WriteBuffer, v: number): void {
		buf.putUi8(Tag.Float64);
		buf.putF(v);
	},

	dec(buf: ReadBuffer): number {
		const tag = buf.getUi8();
		switch(tag) {
		case Tag.Nil:
			return 0;
		case Tag.Float32:
			return buf.getF32();
		case Tag.Float64:
			return buf.getF64();
		default:
			typeError(tag, "float");
		}
	},
};


export const Bytes = {
	enc(buf: WriteBuffer, v: ArrayBuffer): void {
		putBlobHeader(buf, Tag.Bin8, v.byteLength);
		buf.put(v);
	},

	dec(buf: ReadBuffer): ArrayBuffer {
		return buf.get(getBlobHeader(buf));
	},
};


export const Str = {
	enc(buf: WriteBuffer, v: string): void {
		const utf8 = toUTF8(v);
		if(utf8.length < 32) {
			buf.putUi8(fixstrTag(utf8.length));
		} else {
			putBlobHeader(buf, Tag.Str8, utf8.length);
		}
		buf.put(utf8);
	},

	dec(buf: ReadBuffer): string {
		const utf8 = buf.get(getBlobHeader(buf));
		return fromUTF8(utf8);
	},
};


export const Arr = TypedArr(Any);

export function TypedArr(valueT: Type): Type {
	return {
		enc<T extends Type>(buf: WriteBuffer, v: T[]): void {
			if(v.length < 16) {
				buf.putUi8(fixarrayTag(v.length));
			} else {
				putCollectionHeader(buf, Tag.Array16, v.length);
			}
			v.forEach(x => valueT.enc(buf, x));
		},

		dec(buf: ReadBuffer): any[] {
			const tag = buf.getUi8();
			let n = isFixarrayTag(tag)
				? readFixarray(tag)
				: getCollectionHeader(buf, tag, Tag.Array16);

			const res = [];
			while(n-- > 0) {
				res.push(valueT.dec(buf));
			}
			return res;
		},
	};
}


export const Map = TypedMap(Str, Any);

export function TypedMap(keyT: Type, valueT: Type): Type {
	return {
		enc(buf: WriteBuffer, v: any): void {
			const props = [];
			for(const p in v) {
				props.push(p);
			}

			if(props.length < 16) {
				buf.putUi8(fixmapTag(props.length));
			} else {
				putCollectionHeader(buf, Tag.Map16, props.length);
			}

			props.forEach(p => {
				keyT.enc(buf, p);
				valueT.enc(buf, v[p]);
			});
		},

		dec(buf: ReadBuffer): any {
			const tag = buf.getUi8();
			let n = isFixmapTag(tag)
				? readFixmap(tag)
				: getCollectionHeader(buf, tag, Tag.Map16);

			const res = {};
			while(n-- > 0) {
				const k = keyT.dec(buf);
				res[k] = valueT.dec(buf);
			}
			return res;
		},
	};
}



function putBlobHeader(buf: WriteBuffer, baseTag: Tag, n: number): void {
	if(n <= 255) {
		buf.putUi8(baseTag);
		buf.putUi8(n);
	} else if(n <= 65535) {
		buf.putUi8(baseTag + 1);
		buf.putUi16(n);
	} else if(n <= 4294967295) {
		buf.putUi8(baseTag + 2);
		buf.putUi32(n);
	} else {
		throw new RangeError("length limit exceeded");
	}
}

function getBlobHeader(buf: ReadBuffer): number {
	const tag = buf.getUi8();
	switch(tag) {
	case Tag.Nil:
		return 0;
	case Tag.Bin8:
	case Tag.Str8:
		return buf.getUi8();
	case Tag.Bin16:
	case Tag.Str16:
		return buf.getUi16();
	case Tag.Bin32:
	case Tag.Str32:
		return buf.getUi32();
	}

	if(!isFixstrTag(tag)) {
		typeError(tag, "bytes or string");
	}
	return readFixstr(tag);
}


function putCollectionHeader(buf: WriteBuffer, baseTag: Tag, n: number): void {
	if(n <= 65535) {
		buf.putUi8(baseTag);
		buf.putUi16(n);
	} else if(n <= 4294967295) {
		buf.putUi8(baseTag + 1);
		buf.putUi32(n);
	} else {
		throw new RangeError("length limit exceeded");
	}
}

function getCollectionHeader(buf: ReadBuffer, tag: Tag, baseTag: Tag): number {
	switch(tag) {
	case Tag.Nil:
		return 0;
	case baseTag: // 16 bit
		return buf.getUi16();
	case baseTag + 1: // 32 bit
		return buf.getUi32();
	default:
		typeError(tag, "array or map");
	}
}


function toUTF8(v: string): Uint8Array {
	const n = v.length;
	const bin = new Uint8Array(4*n);

	let pos = 0;
	let i = 0;
	let c: number;
	while(i < n) {
		c = v.charCodeAt(i++);
		if((c & 0xfc00) === 0xd800) {
			c = (c<<10) + v.charCodeAt(i++) - 0x35fdc00;
		}

		if(c < 0x80) {
			bin[pos++] = c;
		} else if(c < 0x800) {
			bin[pos++] = 0xc0 + (c >> 6);
			bin[pos++] = 0x80 + (c & 0x3f);
		} else if(c < 0x10000) {
			bin[pos++] = 0xe0 + (c >> 12);
			bin[pos++] = 0x80 + ((c>>6) & 0x3f);
			bin[pos++] = 0x80 + (c & 0x3f);
		} else {
			bin[pos++] = 0xf0 + (c >> 18);
			bin[pos++] = 0x80 + ((c>>12) & 0x3f);
			bin[pos++] = 0x80 + ((c>>6) & 0x3f);
			bin[pos++] = 0x80 + (c & 0x3f);
		}
	}
	return bin.subarray(0, pos);
}

function fromUTF8(buf: ArrayBuffer): string {
	const bin = new Uint8Array(buf);
	let n: number;
	let c: number;
	let codepoints = [];
	for(let i = 0; i < bin.length;) {
		c = bin[i++];
		n = 0;
		switch(c & 0xf0) {
		case 0xf0:  n = 3; break;
		case 0xe0:  n = 2; break;
		case 0xd0:
		case 0xc0:  n = 1; break;
		}

		if(n !== 0) {
			c &= (1 << (6-n)) - 1;
			for(let k = 0; k < n; ++k) {
				c = (c<<6) + (bin[i++] & 0x3f);
			}
		}
		codepoints.push(c);
	}
	return String.fromCodePoint.apply(null, codepoints);
}


function typeError(tag: Tag, expected: string): never {
	throw new TypeError(`unexpected tag 0x${tag.toString(16)} (${expected} expected)`);
}