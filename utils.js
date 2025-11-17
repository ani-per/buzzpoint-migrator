exports.slugify = (text) => text.replace(/\W+/g, "-").toLowerCase().trim();
exports.sanitize = (text) => text.replace(/ *\([^)]*\)/g, "").trim();
exports.shortenAnswerline = (answerline) => answerline.split("[")[0].replace(/ *\([^)]*\)/g, "").replaceAll(/\&nbsp;/g, " ").replaceAll(/\&amp;/g, "\&").trim();
exports.removeTags = (text) => text.replace(/(<([^>]+)>)/ig, "").replaceAll(/\&nbsp;/g, " ").replaceAll(/\&amp;/g, "\&");
exports.slugifyOptions = {
    lower: true,
    strict: true
}
exports.filterPaths = (dir) => (
    dir.filter(f => !(["DS_Store", "zip"].map(s => f.name.endsWith(`.${s}`)).some(f => f))).map(f => f.name)
);
exports.filterFiles = (dir, extension) => (
    dir.filter(f => f.name.endsWith(`.${extension}`))
);
exports.cleanName = (name) => (name.replaceAll(/\(([a-zA-Z0-9]+)\)/g, "").trim());

packetWords = ["packet", "round"];
toTitleCase = (s) => (
    s.toLowerCase().split(" ").map(function (word) {
        if (word === "") return "";
        return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(" ")
);
exports.parsePacketMetadata = (packetName, index) => {
    let packetNumber = index;
    let packetInteger = Math.max.apply(null, packetName.match(/\d+/g));
    let packetDescriptor = "";
    let cleanedPacketFileName = packetName.toLowerCase();
    let cleanedPacketFileNameParts = cleanedPacketFileName.split(/[-–—_,.:|\s+]/);
    if (packetWords.some(s => cleanedPacketFileName.includes(s))) {
        let packetWordIndex = packetWords.findIndex(s => cleanedPacketFileName.includes(s));
        packetDescriptor = toTitleCase(cleanedPacketFileNameParts[packetWordIndex + 1]);
        let packetIdentifierNumber = Math.max.apply(null, packetDescriptor.match(/\d+/g))
        if (packetIdentifierNumber > 0) {
            packetNumber = packetIdentifierNumber;
        }
    } else if (packetInteger > 0) {
        packetNumber = packetInteger;
        packetDescriptor = packetInteger.toString();
    } else if (index) {
        packetDescriptor = index.toString();
    } else {
        console.log(`\tUnable to detect packet number or identifier for ${packetName}. Setting number to ${index} and identifier to ${packetName}.`);
        packetDescriptor = packetName;
    }
    return { descriptor: packetDescriptor, number: packetNumber }
}