const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuraties
const CLUB_ID = process.env.CLUB_ID;
const API_KEY = process.env.API_KEY;
const CLUB_SECRET = process.env.CLUB_SECRET;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL; 

// Database pad voor Railway Volume
const DB_DIR = '/app/data';
const DB_FILE = path.join(DB_DIR, 'sent_reviews.json');

const MIN_VISITS = 20; 
const MAX_MESSAGES_PER_RUN = 5; 

// Zorg dat de directory bestaat (voor Railway Volume)
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify([]));

let sentList = JSON.parse(fs.readFileSync(DB_FILE));

function formatPhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, ''); 
    if (cleaned.startsWith('00')) cleaned = cleaned.substring(2);
    if (cleaned.startsWith('0')) cleaned = '31' + cleaned.substring(1);
    if (!cleaned.startsWith('31')) cleaned = '31' + cleaned;
    return cleaned;
}

async function runReviewBot() {
    console.log("Review Bot start...");
    const timestamp = Date.now() - (90 * 24 * 60 * 60 * 1000);

    try {
        const response = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
            params: { api_key: API_KEY, club_secret: CLUB_SECRET, sync_from: timestamp, limit: 1000 }
        });

        const visits = response.data.result || [];
        const counts = {};
        visits.forEach(v => { counts[v.member_id] = (counts[v.member_id] || 0) + 1; });

        const candidates = Object.keys(counts).filter(id => counts[id] >= MIN_VISITS && !sentList.includes(id));
        console.log(`Kandidaten gevonden: ${candidates.length}`);

        let processed = 0;
        for (const memberId of candidates) {
            if (processed >= MAX_MESSAGES_PER_RUN) break;

            const mRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/member/${memberId}`, {
                params: { api_key: API_KEY, club_secret: CLUB_SECRET }
            });
            const member = mRes.data.result[0] || mRes.data.result;

            if (member && (member.mobile || member.phone)) {
                const formattedPhone = formatPhone(member.mobile || member.phone);
                if (formattedPhone) {
                    await axios.post(MAKE_WEBHOOK_URL, {
                        telefoon: formattedPhone,
                        voornaam: member.firstname
                    });
                    sentList.push(memberId);
                    processed++;
                    console.log(`Webhook verstuurd: ${member.firstname}`);
                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        }
        fs.writeFileSync(DB_FILE, JSON.stringify(sentList));
        console.log("Run voltooid.");
    } catch (e) { console.error("Fout:", e.message); }
}

runReviewBot();