const axios = require('axios');

const CLUB_ID = process.env.CLUB_ID;
const API_KEY = process.env.API_KEY;
const CLUB_SECRET = process.env.CLUB_SECRET;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL; 

// TEST-MODUS: Staat op true. Alleen de allereerste match gaat naar Make voor de test.
const DRY_RUN = true; 

// CONFIGURATIE
const MIN_VISITS = 15; 
const MAX_VISITS = 16; 
const RECENT_DAYS = 3; 

function formatPhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, ''); 
    if (cleaned.startsWith('00')) cleaned = cleaned.substring(2);
    if (cleaned.startsWith('0') && !cleaned.startsWith('00')) cleaned = '31' + cleaned.substring(1);
    if (!cleaned.startsWith('31')) cleaned = '31' + cleaned;
    return cleaned;
}

async function runReviewBot() {
    console.log(`--- [TURBO-MODE] START SCAN (Grote Volumes) ---`);
    
    const timestamp90Days = Date.now() - (90 * 24 * 60 * 60 * 1000);
    const timestampRecent = Date.now() - (RECENT_DAYS * 24 * 60 * 60 * 1000);

    try {
        let allVisits = [];
        let offset = 0;
        let fetchMore = true;

        console.log("Stap 1: Alle check-ins ophalen (90 dagen historie)...");

        // We blijven ophalen tot we alles hebben (max 25.000 records voor de veiligheid)
        while (fetchMore && offset < 25000) {
            const res = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
                params: { 
                    api_key: API_KEY, 
                    club_secret: CLUB_SECRET, 
                    sync_from: timestamp90Days,
                    limit: 1000,
                    offset: offset
                }
            });

            const v = res.data.result || [];
            allVisits = allVisits.concat(v);
            
            console.log(`   Voortgang: ${allVisits.length} records opgehaald...`);

            if (v.length < 1000) {
                fetchMore = false;
            } else {
                offset += 1000;
                // Korte pauze om VG API te respecteren
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        console.log(`Totaal aantal check-ins in geheugen: ${allVisits.length}`);

        // Stap 2: Tellen en laatste bezoek vastleggen
        const counts = {};
        const lastVisit = {};

        allVisits.forEach(v => {
            const id = v.member_id;
            counts[id] = (counts[id] || 0) + 1;
            // Update laatste bezoek timestamp
            if (!lastVisit[id] || v.check_in_timestamp > lastVisit[id]) {
                lastVisit[id] = v.check_in_timestamp;
            }
        });

        // Stap 3: Filteren
        const candidates = Object.keys(counts).filter(id => {
            return counts[id] >= MIN_VISITS && 
                   counts[id] <= MAX_VISITS && 
                   lastVisit[id] > timestampRecent;
        });

        console.log(`Stap 2: Analyse voltooid. ${candidates.length} kandidaten gevonden.`);

        // Stap 4: Details ophalen en verzenden (max 5 per run)
        const batch = candidates.slice(0, 5);
        for (let i = 0; i < batch.length; i++) {
            const memberId = batch[i];
            const mRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/member/${memberId}`, {
                params: { api_key: API_KEY, club_secret: CLUB_SECRET }
            });
            
            const member = Array.isArray(mRes.data.result) ? mRes.data.result[0] : mRes.data.result;

            if (member) {
                const phone = formatPhone(member.mobile || member.phone);
                console.log(`> MATCH: ${member.firstname} (Totaal: ${counts[memberId]})`);
                
                // Stuur alleen de eerste in DRY_RUN, of alles in LIVE-MODE
                if (i === 0 || !DRY_RUN) {
                    if (MAKE_WEBHOOK_URL && phone) {
                        console.log(`  [WEBHOOK] Verzenden voor ${member.firstname}...`);
                        await axios.post(MAKE_WEBHOOK_URL, {
                            telefoon: phone,
                            voornaam: member.firstname,
                            bezoeken: counts[memberId],
                            member_id: memberId
                        });
                    }
                }
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        console.log("--- SCAN VOLTOOID ---");
    } catch (e) {
        console.error("Fout tijdens Turbo-scan:", e.message);
    }
}

runReviewBot();
