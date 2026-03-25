const axios = require('axios');

const CLUB_ID = process.env.CLUB_ID;
const API_KEY = process.env.API_KEY;
const CLUB_SECRET = process.env.CLUB_SECRET;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL; 

const DRY_RUN = false; 

// CONFIGURATIE
const MIN_VISITS = 15; 
const MAX_VISITS = 16; 
const RECENT_DAYS = 3; 
const MAX_CANDIDATES_PER_RUN = 5;

// STARTPUNT: 1 Maart 2024
const START_DATE_BOT = new Date('2024-03-01T00:00:00').getTime();

// 12 seconden pauze = 300 requests per uur (zeer veilig voor de 500-limiet)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function formatPhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, ''); 
    if (cleaned.startsWith('00')) cleaned = cleaned.substring(2);
    if (cleaned.startsWith('0') && !cleaned.startsWith('00')) cleaned = '31' + cleaned.substring(1);
    if (!cleaned.startsWith('31')) cleaned = '31' + cleaned;
    return cleaned;
}

async function runReviewBot() {
    console.log(`--- [NIGHT-SCAN] START (Vanaf 1 maart 2024) ---`);
    const timestampRecent = Date.now() - (RECENT_DAYS * 24 * 60 * 60 * 1000);

    try {
        console.log(`Stap 1: Actieve leden ophalen...`);
        const res = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
            params: { api_key: API_KEY, club_secret: CLUB_SECRET, sync_from: timestampRecent, limit: 1000 }
        });

        const recentVisits = res.data.result || [];
        const uniqueMemberIds = [...new Set(recentVisits.map(v => v.member_id))];
        
        console.log(`Analyse van ${uniqueMemberIds.length} leden start nu.`);

        const candidates = [];

        for (let i = 0; i < uniqueMemberIds.length; i++) {
            const memberId = uniqueMemberIds[i];
            
            try {
                const historyRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
                    params: { 
                        api_key: API_KEY, 
                        club_secret: CLUB_SECRET, 
                        member_id: memberId,
                        sync_from: START_DATE_BOT 
                    }
                });

                const count = (historyRes.data.result || []).length;
                
                if (count >= MIN_VISITS && count <= MAX_VISITS) {
                    candidates.push({ id: memberId, count: count });
                    console.log(`Match gevonden: Lid ${memberId} (Bezoeken: ${count})`);
                }
            } catch (err) {
                console.error(`Fout bij lid ${memberId}:`, err.message);
                if (err.response && err.response.status === 429) {
                    await sleep(60000); // 1 minuut extra pauze bij 429
                    i--; continue;
                }
            }

            await sleep(12000); // 12 sec pauze tussen elk lid

            if (candidates.length >= MAX_CANDIDATES_PER_RUN) break;
        }

        // Stap 3: Verzenden naar Make
        for (const cand of candidates) {
            const mRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/member/${cand.id}`, {
                params: { api_key: API_KEY, club_secret: CLUB_SECRET }
            });
            const member = Array.isArray(mRes.data.result) ? mRes.data.result[0] : mRes.data.result;

            if (member) {
                const phone = formatPhone(member.mobile || member.phone);
                if (phone && !DRY_RUN && MAKE_WEBHOOK_URL) {
                    await axios.post(MAKE_WEBHOOK_URL, {
                        telefoon: phone,
                        voornaam: member.firstname,
                        bezoeken: cand.count
                    });
                    console.log(`Data naar Make gestuurd voor: ${member.firstname}`);
                }
            }
            await sleep(2000);
        }
        console.log("--- NACHT-SCAN VOLTOOID ---");
    } catch (e) { console.error("Fout:", e.message); }
}

runReviewBot();
