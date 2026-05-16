const stringDetachEncoder = new TextEncoder();
const stringDetachDecoder = new TextDecoder();

// Forces a fresh backing string so a retained substring does not keep the
// original raw patch/file text alive.
export function detachString(value: string): string {
  if (value.length === 0) {
    return value;
  }

  if (!hasSurrogateCodeUnit(value)) {
    return stringDetachDecoder.decode(stringDetachEncoder.encode(value));
  }

  return JSON.parse(JSON.stringify(value)) as string;
}

function hasSurrogateCodeUnit(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}
