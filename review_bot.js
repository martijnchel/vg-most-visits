const axios = require('axios');

// Omgevingsvariabelen uit Railway
const CLUB_ID = process.env.CLUB_ID;
const API_KEY = process.env.API_KEY;
const CLUB_SECRET = process.env.CLUB_SECRET;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL; 

// LIVE-MODUS
const DRY_RUN = false; 

// CONFIGURATIE
const MIN_VISITS = 15; 
const MAX_VISITS = 16; 
const RECENT_DAYS = 3; 
const MAX_CANDIDATES_PER_RUN = 5;
const START_DATE_BOT = new Date('2024-03-01T00:00:00').getTime();

// Hulpmiddelen
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function formatPhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, ''); 
    if (cleaned.startsWith('00')) cleaned = cleaned.substring(2);
    if (cleaned.startsWith('0') && !cleaned.startsWith('00')) cleaned = '31' + cleaned.substring(1);
    if (!cleaned.startsWith('31')) cleaned = '31' + cleaned;
    return cleaned;
}

// Wachtfunctie tot 10:00 uur 's ochtends (Nederlandse tijd)
async function waitUntilTenAM() {
    const now = new Date();
    const tenAM = new Date();
    tenAM.setHours(10, 0, 0, 0);

    // Als het al na 10:00 is (bijv. bij handmatige start), stuur dan direct
    if (now > tenAM) {
        console.log("[TIMER] Het is al na 10:00 uur, we gaan direct door naar verzending.");
        return;
    }

    const msToWait = tenAM - now;
    const minutes = Math.round(msToWait / 60000);
    console.log(`[TIMER] Scan klaar. We wachten ${minutes} minuten tot het 10:00 uur is...`);
    await sleep(msToWait);
}

async function runReviewBot() {
    console.log(`--- [START] NACHT-SCAN (Nulpunt: 1 maart 2024) ---`);
    const timestampRecent = Date.now() - (RECENT_DAYS * 24 * 60 * 60 * 1000);

    try {
        // Stap 1: Actieve leden van de afgelopen 3 dagen ophalen
        const res = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
            params: { 
                api_key: API_KEY, 
                club_secret: CLUB_SECRET, 
                sync_from: timestampRecent, 
                limit: 1000 
            }
        });

        const recentVisits = res.data.result || [];
        const uniqueMemberIds = [...new Set(recentVisits.map(v => v.member_id))];
        const candidates = [];

        console.log(`Stap 2: Analyse van ${uniqueMemberIds.length} actieve leden (15 sec pauze per check)...`);

        for (let i = 0; i < uniqueMemberIds.length; i++) {
            const memberId = uniqueMemberIds[i];
            
            try {
                const hRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
                    params: { 
                        api_key: API_KEY, 
                        club_secret: CLUB_SECRET, 
                        member_id: memberId, 
                        sync_from: START_DATE_BOT 
                    }
                });

                const count = (hRes.data.result || []).length;
                if (count >= MIN_VISITS && count <= MAX_VISITS) {
                    candidates.push({ id: memberId, count: count });
                    console.log(`   [MATCH] Lid ${memberId} gevonden met ${count} bezoeken.`);
                }
            } catch (err) {
                if (err.response && err.response.status === 429) {
                    console.log("Rate limit geraakt, we wachten 2 minuten extra...");
                    await sleep(120000); i--; continue;
                }
            }

            // Rustig tempo om API te sparen
            await sleep(15000); 

            // Stop als we de limiet van 5 personen hebben bereikt
            if (candidates.length >= MAX_CANDIDATES_PER_RUN) break;
        }

        // Stap 3: Wachten op het juiste verzendmoment
        if (candidates.length > 0) {
            console.log(`Totaal ${candidates.length} kandidaten gevonden. Wachten op 10:00 uur.`);
            await waitUntilTenAM();

            console.log(`Stap 4: Webhooks versturen naar Make...`);
            for (const cand of candidates) {
                const mRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/member/${cand.id}`, {
                    params: { api_key: API_KEY, club_secret: CLUB_SECRET }
                });
                
                const member = Array.isArray(mRes.data.result) ? mRes.data.result[0] : mRes.data.result;

                if (member && MAKE_WEBHOOK_URL) {
                    const phone = formatPhone(member.mobile || member.phone);
                    console.log(`> TRIGGER: Webhook voor ${member.firstname} (${cand.count} bezoeken)`);
                    
                    await axios.post(MAKE_WEBHOOK_URL, {
                        telefoon: phone,
                        voornaam: member.firstname,
                        bezoeken: cand.count
                    });

                    // 5 seconden pauze tussen de afzonderlijke webhooks
                    await sleep(5000);
                }
            }
        } else {
            console.log("Geen kandidaten gevonden die voldeden aan de criteria.");
        }

        console.log("--- SCAN EN VERZENDING VOLTOOID ---");
    } catch (e) {
        console.error("Kritieke fout in script:", e.message);
    }
}

runReviewBot();
