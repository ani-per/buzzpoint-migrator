exports.slugify = (text) => text.replace(/\W+/g, "-").toLowerCase().trim();
exports.sanitize = (text) => text.replace(/ *\([^)]*\)/g, "").trim();
exports.shortenAnswerline = (answerline) => answerline.split("[")[0].replace(/ *\([^)]*\)/g, "").replaceAll(/\&nbsp;/g, " ").replaceAll(/\&amp;/g, "\&").trim();
exports.removeTags = (text) => text.replace(/(<([^>]+)>)/ig, "").replaceAll(/\&nbsp;/g, " ").replaceAll(/\&amp;/g, "\&");
exports.slugifyOptions = {
    remove: /[*+~.()'"!:@]/g,
    lower: true,
    strict: true,
}
exports.filterPaths = (dir) => (
    dir.filter(f => !(["DS_Store", "zip"].map(s => f.name.endsWith(`.${s}`)).some(f => f))).map(f => f.name)
);
exports.filterFiles = (dir, extension) => (
    dir.filter(f => f.name.endsWith(`.${extension}`))
);
exports.cleanName = (name) => (name.replaceAll(/\(([a-zA-Z0-9]+)\)/g, "").replaceAll(" ", " ").trim());
exports.cleanPacketName = (name) => (name.replaceAll(".json", "").replaceAll("copy", "").replaceAll(/\((\d+)\)/g, "").trim());

packetWords = ["packet", "round"];
toTitleCase = (s) => (
    s.toLowerCase().split(" ").map(function (word) {
        if (word === "") return "";
        return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(" ")
);
exports.parsePacketMetadata = (packetName, index) => {
    let packetNumber = index;
    let packetDescriptor = "";
    let packetIntegers = (packetName.match(/\d+/g) || []).map(s => parseInt(s));
    let cleanedPacketFileName = packetName.toLowerCase();
    let cleanedPacketFileNameParts = cleanedPacketFileName.split(/[-–—_,.:|\s+]/);
    if (packetWords.some(s => cleanedPacketFileName.includes(s))) {
        let packetWordIndex = cleanedPacketFileNameParts.findIndex(
            fileNamePart => packetWords.some(s => fileNamePart.includes(s))
        );
        packetDescriptor = toTitleCase(cleanedPacketFileNameParts[packetWordIndex + 1]);
        let packetIdentifierNumber = parseInt(packetDescriptor.match(/\d+/g));
        if (packetIdentifierNumber > 0 && packetIdentifierNumber < 25) {
            packetDescriptor = packetIdentifierNumber.toString();
            packetNumber = packetIdentifierNumber;
        }
    } else if (packetIntegers.length > 0) {
        packetNumber = packetIntegers.find(i => i > 0 && i < 25) || index;
        packetDescriptor = packetNumber.toString();
    } else if (packetIntegers.length == 0) {
        if (packetName.length < 3) {
            packetDescriptor = packetName;
        } else {
            packetDescriptor = index.toString();
        }
    } else {
        console.log(`\tCouldn't detect packet number or identifier for ${packetName}. Setting number to ${index} and identifier to ${packetName}.`);
        packetDescriptor = packetName;
    }
    return { descriptor: packetDescriptor, number: packetNumber }
}

exports.findSimilarNames = (playerNames) => {
    // Source - https://stackoverflow.com/a/55813146
    // Posted by trincot
    // Retrieved 2026-02-01, License - CC BY-SA 4.0

    const nameMap = {};
    const pairs = new Set;
    for (const playerName of playerNames) {
        for (const i in playerName + "_") { // Additional iteration to NOT delete a character
            const key = (playerName.slice(0, i) + playerName.slice(+i + 1, playerName.length)).toLowerCase();
            // Group words together where the removal from the same index leads to the same key
            if (!nameMap[key]) nameMap[key] = Array.from({ length: key.length + 1 }, () => new Set);
            // If NO character was removed, put the word in EACH group
            for (const set of (+i < playerName.length ? [nameMap[key][i]] : nameMap[key])) {
                if (set.has(playerName)) continue;
                for (let similar of set) pairs.add(JSON.stringify([similar, playerName].sort()));
                set.add(playerName);
            }
        }
    }
    const result = [...pairs].sort().map(JSON.parse); // sort is optional
    return result;
}