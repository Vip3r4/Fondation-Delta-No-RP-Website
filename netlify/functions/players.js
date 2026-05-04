const fetch = require('node-fetch');

exports.handler = async () => {
    const res = await fetch('https://api.scpslgame.com/serverinfo.php?id=36034&key=iVJbgCO0g5Tnfrc6rlI/2J2R&players=true');
    const data = await res.json();

    return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data)
    };
};