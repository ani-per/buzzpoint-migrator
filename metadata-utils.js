const subcategoryMap = require("./subcat-to-cat.json");

const formatTypes = {
    acf: 1,
    powers: 2,
    superpowers: 3,
    pace: 4
}

const metadataTypes = {
    default: 1,
    noAuthor: 2,
    authorAndCategory: 3,
    nsc: 4,
    nasat: 5,
    qbReader: 6,
    none: 7,
}

const parseMetadata = (metadata, metadataType, authorFirst = true) => {
    let category = "", subcategory = "", subsubcategory = "", author = "", editor = "";
    let categoryIndex = authorFirst ? 2 : 1;
    let authorIndex = authorFirst ? 1 : 2;

    if (metadata) {
        if (metadataType === metadataTypes.default) {
            const regex = new RegExp(/(.*?), (.*)/);
            const metadataMatch = metadata?.match(regex) || [];
            const rawCategory = metadataMatch[categoryIndex];

            author = metadataMatch[authorIndex]?.trim();
            [subcategory, subsubcategory] = (rawCategory || "").split(" - ");
            category = subcategoryMap[subcategory] || subcategory;
        } else if (metadataType === metadataTypes.noAuthor) {
            subcategory = metadata;
            category = subcategoryMap[subcategory] || subcategory;
        } else if (metadataType === metadataTypes.authorAndCategory) {
            const regex = new RegExp(/(.*?)[,-](.*)/);
            const metadataMatch = metadata?.match(regex) || [];

            author = metadataMatch[authorIndex]?.trim();
            subcategory = metadataMatch[categoryIndex]?.trim();
            category = subcategoryMap[subcategory] || subcategory;
        } else if (metadataType === metadataTypes.nsc) {
            const regex = new RegExp(/(.+?), (.*)&gt;.*Editor: (.*)/);
            const metadataMatch = metadata?.match(regex) || [];
            const rawCategory = metadataMatch[categoryIndex];

            author = metadataMatch[authorIndex];
            editor = metadataMatch[3];
            [category, subcategory, subsubcategory] = (rawCategory || "").split(" - ");
        } else if (metadataType === metadataTypes.nasat) {
            const regex = new RegExp(/(.+?) , (.*)/);
            const metadataMatch = metadata?.match(regex) || [];
            const rawCategory = metadataMatch[categoryIndex];

            author = metadataMatch[authorIndex];
            [category, subcategory, subsubcategory] = (rawCategory || "").split(" - ");
        } else if (metadataType === metadataTypes.qbReader) {
            const metadataMatch = metadata.split(" - ");
            category = metadataMatch[0];
            subcategory = metadataMatch[1];
            if (metadataMatch.length > 2) {
                subsubcategory = metadataMatch[2];
            }
        } else if (metadataType === metadataTypes.none) {
            // No processing required
        } else {
            console.error("Improper metadata style.");
        }
    }
    subcategory = subcategory.replaceAll(category, "").trim();

    return {
        category,
        subcategory,
        subsubcategory,
        author,
        editor
    }
}

module.exports = {
    formatTypes,
    metadataTypes,
    parseMetadata
}
