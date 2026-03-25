const axios = require('axios');

const CLUB_ID = process.env.CLUB_ID;
const API_KEY = process.env.API_KEY;
const CLUB_SECRET = process.env.CLUB_SECRET;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL; 

// TEST-MODUS: Staat op true voor de veiligheid. Zet op false om echt te gaan verzenden.
const DRY_RUN = true; 

// CONFIGURATIE
const MIN_VISITS = 15; 
const MAX_VISITS = 16; 
const RECENT_DAYS = 7; 

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
    console.log(`--- [${DRY_RUN ? 'TEST-MODE' : 'LIVE-MODE'}] START SCAN ---`);
    console.log(`Gepland tijdstip: Maandag & Donderdag 14:30 uur.`);
    
    const timestampRecent = Date.now() - (RECENT_DAYS * 24 * 60 * 60 * 1000); 

    try {
        console.log(`Stap 1: Recente bezoekers ophalen...`);
        const response = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
            params: { api_key: API_KEY, club_secret: CLUB_SECRET, sync_from: timestampRecent, limit: 1000 }
        });

        const recentVisits = response.data.result || [];
        if (recentVisits.length === 0) return console.log("Geen check-ins gevonden.");

        const uniqueMemberIds = [...new Set(recentVisits.map(v => v.member_id))];
        const candidates = [];
        const timestamp90Days = Date.now() - (90 * 24 * 60 * 60 * 1000);

        console.log(`Stap 2: Analyse van ${uniqueMemberIds.length} leden. Dit duurt ongeveer ${Math.round((uniqueMemberIds.length * 2) / 60)} minuten.`);

        for (let i = 0; i < uniqueMemberIds.length; i++) {
            const memberId = uniqueMemberIds[i];
            
            try {
                const memberVisitsRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
                    params: { api_key: API_KEY, club_secret: CLUB_SECRET, sync_from: timestamp90Days, member_id: memberId }
                });

                const count = (memberVisitsRes.data.result || []).length;
                if (count >= MIN_VISITS && count <= MAX_VISITS) {
                    candidates.push({ id: memberId, count: count });
                }
            } catch (err) {
                if (err.response && err.response.status === 429) {
                    console.log("Rate limit geraakt. We wachten 30 seconden...");
                    await sleep(30000); 
                    i--; 
                    continue;
                }
                console.error(`Fout bij lid ${memberId}:`, err.message);
            }

            await sleep(2000); // 2 seconden pauze per lid
            
            if (i % 10 === 0 && i > 0) {
                console.log(`Voortgang: ${i}/${uniqueMemberIds.length} leden verwerkt...`);
            }
        }
        
        console.log(`Klaar met analyse. Gevonden kandidaten (15-16 bezoeken): ${candidates.length}`);

        // STAP 3: VERZENDING
        if (candidates.length > 0) {
            for (let j = 0; j < Math.min(candidates.length, 5); j++) {
                const cand = candidates[j];
                const mRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/member/${cand.id}`, {
                    params: { api_key: API_KEY, club_secret: CLUB_SECRET }
                });
                const member = Array.isArray(mRes.data.result) ? mRes.data.result[0] : mRes.data.result;

                if (member) {
                    const phone = formatPhone(member.mobile || member.phone);
                    // In DRY_RUN sturen we alleen de eerste voor de Make test
                    if (j === 0 || !DRY_RUN) {
                        console.log(`> VERSTUREN: ${member.firstname} (Tel: ${phone})`);
                        if (MAKE_WEBHOOK_URL) {
                            await axios.post(MAKE_WEBHOOK_URL, {
                                telefoon: phone,
                                voornaam: member.firstname,
                                bezoeken: cand.count
                            });
                        }
                        await sleep(2000);
                    } else {
                        console.log(`> MATCH (Dry-run): ${member.firstname} | Bezoeken: ${cand.count}`);
                    }
                }
            }
        }

        console.log("--- SCAN VOLTOOID ---");
    } catch (e) { console.error("Fout in script:", e.message); }
}

runReviewBot();
