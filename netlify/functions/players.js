exports.handler = async () => {
    const id = process.env.SCPSL_ID;
    const key = process.env.SCPSL_KEY;

    const res = await fetch(`https://api.scpslgame.com/serverinfo.php?id=${id}&key=${key}&players=true`);
    const data = await res.json();

    return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(data)
    };
};