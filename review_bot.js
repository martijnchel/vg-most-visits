const axios = require('axios');

const CLUB_ID = process.env.CLUB_ID;
const API_KEY = process.env.API_KEY;
const CLUB_SECRET = process.env.CLUB_SECRET;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL; 

// TEST-MODUS: Staat nu op true voor veiligheid en de eenmalige webhook-test
const DRY_RUN = true; 

// CONFIGURATIE (Trigger op 15e of 16e bezoek)
const MIN_VISITS = 15; 
const MAX_VISITS = 16; 
const RECENT_DAYS = 7; 

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
    
    const timestampRecent = Date.now() - (RECENT_DAYS * 24 * 60 * 60 * 1000); 

    try {
        console.log(`Stap 1: Recente bezoekers ophalen...`);
        const response = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
            params: { 
                api_key: API_KEY, 
                club_secret: CLUB_SECRET, 
                sync_from: timestampRecent,
                limit: 1000 
            }
        });

        const recentVisits = response.data.result || [];
        if (recentVisits.length === 0) {
            console.log("Geen check-ins gevonden in de afgelopen week.");
            return;
        }

        const uniqueMemberIds = [...new Set(recentVisits.map(v => v.member_id))];
        const candidates = [];
        const timestamp90Days = Date.now() - (90 * 24 * 60 * 60 * 1000);

        console.log(`Stap 2: 90-dagen historie checken voor ${uniqueMemberIds.length} leden...`);

        for (const memberId of uniqueMemberIds) {
            const memberVisitsRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/visits`, {
                params: { 
                    api_key: API_KEY, 
                    club_secret: CLUB_SECRET, 
                    sync_from: timestamp90Days,
                    member_id: memberId 
                }
            });

            const count = (memberVisitsRes.data.result || []).length;
            if (count >= MIN_VISITS && count <= MAX_VISITS) {
                candidates.push({ id: memberId, count: count });
            }
            await new Promise(r => setTimeout(r, 100)); // Rate limiting
        }
        
        console.log(`Gevonden kandidaten (15-16 bezoeken): ${candidates.length}`);

        // STAP 3: DATA STRUCTURE TEST (We sturen er altijd één naar Make voor de test)
        if (candidates.length > 0) {
            const firstCand = candidates[0];
            const mRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/member/${firstCand.id}`, {
                params: { api_key: API_KEY, club_secret: CLUB_SECRET }
            });
            const memberData = mRes.data.result;
            const member = Array.isArray(memberData) ? memberData[0] : memberData;

            if (member) {
                const phone = formatPhone(member.mobile || member.phone);
                console.log(`> TEST VERZENDING NAAR MAKE: ${member.firstname} (${phone})`);
                
                // We sturen deze ALTIJD, zelfs in DRY_RUN, om Make te configureren
                await axios.post(MAKE_WEBHOOK_URL, {
                    telefoon: phone,
                    voornaam: member.firstname,
                    bezoeken: firstCand.count,
                    member_id: firstCand.id
                });
                console.log(" Check nu Make om de variabelen te koppelen.");
            }
        }

        // De rest van de batch (alleen als DRY_RUN uit staat)
        if (!DRY_RUN && candidates.length > 1) {
            for (const cand of candidates.slice(1, 5)) {
                const mRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/member/${cand.id}`, {
                    params: { api_key: API_KEY, club_secret: CLUB_SECRET }
                });
                const member = Array.isArray(mRes.data.result) ? mRes.data.result[0] : mRes.data.result;
                if (member) {
                    const phone = formatPhone(member.mobile || member.phone);
                    if (phone) {
                        await axios.post(MAKE_WEBHOOK_URL, {
                            telefoon: phone,
                            voornaam: member.firstname,
                            bezoeken: cand.count,
                            member_id: cand.id
                        });
                        console.log(`> LIVE VERZONDEN: ${member.firstname}`);
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
            }
        }

        console.log("--- SCAN VOLTOOID ---");
    } catch (e) {
        console.error("FOUT:", e.message);
    }
}

runReviewBot();
