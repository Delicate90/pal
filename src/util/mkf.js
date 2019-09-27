const getFileHeader = (source) => ({
    Signature: source.getUint32(0, true),
    UncompressedLength: source.getUint32(4, true),
    CompressedLength: source.getUint32(8, true),
    BlockCount: source.getUint16(12, true),
    Unknown: source.getUint8(14),
    HuffmanTreeLength: source.getUint8(15)
});

const getBlockHeader = (source) => ({
    UncompressedLength: source.getUint16(0, true),
    CompressedLength: source.getUint16(2, true),
    LZSSRepeatTable: [
        source.getUint16(4, true),
        source.getUint16(6, true),
        source.getUint16(8, true),
        source.getUint16(10, true)
    ],
    LZSSOffsetCodeLengthTable: [
        source.getUint8(12),
        source.getUint8(13),
        source.getUint8(14),
        source.getUint8(15)
    ],
    LZSSRepeatCodeLengthTable: [
        source.getUint8(16),
        source.getUint8(17),
        source.getUint8(18)
    ],
    CodeCountCodeLengthTable: [
        source.getUint8(19),
        source.getUint8(20),
        source.getUint8(21)
    ],
    CodeCountTable: [
        source.getUint8(22),
        source.getUint8(23)
    ]
});

const getBits = (src, bitptr, count) => {
    const temp = new Uint8Array(src.buffer, src.byteOffset + ((bitptr[0] >> 4) << 1));
    const bptr = bitptr[0] & 0xf;
    bitptr[0] += count;
    if (count > 16 -bptr) {
        count = count + bptr - 16;
        const mask = 0xffff >> bptr;
        return (((temp[0] | (temp[1] << 8)) & mask) << count) | ((temp[2] | (temp[3] << 8)) >> (16 - count))
    } else {
        const e = (temp[0] | (temp[1] << 8)) << bptr;
        return ((e & 0xffff) >> (16 - count))
    }
};

const getLoop = (src, bitptr, header) => {
    if (getBits(src, bitptr, 1)) {
        return header.CodeCountTable[0]
    } else {
        const temp = getBits(src, bitptr, 2);
        if (temp) {
            return getBits(src, bitptr, header.CodeCountCodeLengthTable[temp - 1])
        } else {
            return header.CodeCountTable[1]
        }
    }
};

const getCount = (src, bitptr, header) => {
    const temp = getBits(src, bitptr, 2);
    if (temp !== 0 && getBits(src, bitptr, 1)) {
        return getBits(src, bitptr, header.LZSSRepeatCodeLengthTable[temp - 1])
    }
    return header.LZSSRepeatTable[0]
};

const Decompress = (Source, Destination, DestSize) => {
    if (Source == null) return -1;
    const hdr = getFileHeader(Source);
    if (hdr.Signature !== 0x315f4a59) return -1;
    if (hdr.UncompressedLength > DestSize) return -1;

    let src = 0;
    let dest = 0;
    const treeLen = hdr.HuffmanTreeLength * 2;
    let bitptr = [0];
    const flag = new DataView(Source.buffer, Source.byteOffset + src + 16 + treeLen);

    let tree = new Array(treeLen + 1).fill({value: 0, lear: 0, level: 0, weight: 0, left: null, right: null});

    tree[0].leaf = 0;
    tree[0].value = 0;
    tree[0].left = 1;
    tree[0].right = 2;

    for (let index = 1; index <= treeLen; index++) {
        tree[index] = !getBits(flag, bitptr, 1);
        tree[index] = Source.getUint8(src + 15 + index);
        if (tree[index].leaf) {
            tree[index].left = null;
            tree[index].right = null;
        }
        else {
            tree[index].left = (tree[index].value << 1) + 1;
            tree[index].right = tree[index].left + 1;
        }
    }

    src += 16 + treeLen + (((treeLen & 0xf) ? (treeLen >> 4) + 1 : (treeLen >> 4)) << 1);

    for (let i = 0; i < hdr.BlockCount; i++) {

        const header = getBlockHeader(new DataView(Source.buffer, Source.byteOffset + src));
        const headerPos = src;
        src += 4;
        if (!header.CompressedLength) {
            let hul = header.UncompressedLength;
            while (hul--) {
                Destination.setUint8(dest++, Source.getUint8(src++));
            }
            continue;
        }
        src += 20;
        bitptr = [0];
        for (;;) {
            let loop;
            if ((loop = getLoop(new DataView(Source.buffer, Source.byteOffset + src), bitptr, header)) === 0)
                break;
            while (loop--) {
                let nodeIndex = 0;
                for (; !tree[nodeIndex].leaf;) {
                    if (getBits(new DataView(Source.buffer, Source.byteOffset + src), bitptr, 1))
                        nodeIndex = tree[nodeIndex].right;
                    else
                        nodeIndex = tree[nodeIndex].left;
                }
                Destination.setUint8(dest++, tree[nodeIndex].value);
            }

            if ((loop = getLoop(new DataView(Source.buffer, Source.byteOffset + src), bitptr, header)) === 0)
                break;

            while (loop--) {
                let count = getCount(new DataView(Source.buffer, Source.byteOffset + src), bitptr, header);
                let pos = getBits(new DataView(Source.buffer, Source.byteOffset + src), bitptr, 2);
                pos = getBits(new DataView(Source.buffer, Source.byteOffset + src), bitptr, header.LZSSOffsetCodeLengthTable[pos]);
                while (count--) {
                    Destination.setUint8(dest, Destination.getUint8(dest - pos));
                    dest++;
                }
            }
        }
        src = headerPos + header.CompressedLength;
    }
    return hdr.UncompressedLength;
};

exports.unzip = Decompress;