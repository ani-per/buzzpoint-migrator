exports.slugify = (text) => text.replace(/\W+/g, "-").toLowerCase().trim();
exports.sanitize = (text) => text.replace(/ *\([^)]*\)/g, "").trim();
exports.shortenAnswerline = (answerline) => answerline.split("[")[0].replace(/ *\([^)]*\)/g, "").replaceAll(/\&nbsp;/g, " ").replaceAll(/\&amp;/g, "\&").trim();
exports.removeTags = (text) => text.replace(/(<([^>]+)>)/ig, "").replaceAll(/\&nbsp;/g, " ").replaceAll(/\&amp;/g, "\&");
exports.slugifyOptions = {
    lower: true,
    strict: true
}
exports.toTitleCase = (s) => (
    s.toLowerCase().split(" ").map(function (word) {
        if (word === "") return "";
        return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(" ")
);
exports.filterPaths = (dir) => (
    dir.filter(f => !(["DS_Store", "zip"].map(s => f.name.endsWith(`.${s}`)).some(f => f))).map(f => f.name)
);
exports.filterFiles = (dir, extension) => (
    dir.filter(f => f.name.endsWith(`.${extension}`)).map(f => f.name)
);