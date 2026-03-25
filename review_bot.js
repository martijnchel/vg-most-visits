const axios = require('axios');

const CLUB_ID = process.env.CLUB_ID;
const API_KEY = process.env.API_KEY;
const CLUB_SECRET = process.env.CLUB_SECRET;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL; 

// TEST-MODUS: Op true laten staan om logs te checken. Op false zetten om echt te verzenden.
const DRY_RUN = true; 

// CONFIGURATIE
const MIN_VISITS = 15; 
const MAX_VISITS = 22; 
const RECENT_DAYS = 7; // We kijken naar wie er de afgelopen week is geweest

function formatPhone(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/\D/g, ''); 
    if (cleaned.startsWith('00')) cleaned = cleaned.substring(2);
    if (cleaned.startsWith('0')) cleaned = '31' + cleaned.substring(1);
    if (!cleaned.startsWith('31')) cleaned = '31' + cleaned;
    return cleaned;
}

async function runReviewBot() {
    console.log(`--- [${DRY_RUN ? 'TEST-MODE' : 'LIVE-MODE'}] START SCAN ---`);
    
    // Stap 1: Haal check-ins op van de afgelopen 7 dagen
    const timestampRecent = Date.now() - (RECENT_DAYS * 24 * 60 * 60 * 1000); 

    try {
        console.log(`Stap 1: Recente bezoekers ophalen (sinds ${new Date(timestampRecent).toLocaleDateString()})...`);
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
            console.log("Geen check-ins gevonden in de afgelopen 7 dagen. Scan gestopt.");
            return;
        }

        // Maak een lijst van unieke leden die de afgelopen week zijn geweest
        const uniqueMemberIds = [...new Set(recentVisits.map(v => v.member_id))];
        console.log(`${recentVisits.length} check-ins gevonden van ${uniqueMemberIds.length} unieke leden.`);

        const candidates = [];
        const timestamp90Days = Date.now() - (90 * 24 * 60 * 60 * 1000);

        console.log(`Stap 2: Bezoektotaal (90d) controleren voor deze ${uniqueMemberIds.length} leden...`);

        // Stap 2: Loop door de actieve leden en check hun 90-dagen historie
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
            // Kleine pauze om de API niet te overbelasten (rate limiting)
            await new Promise(r => setTimeout(r, 100));
        }
        
        console.log(`Resultaat: ${candidates.length} leden zitten in de zone van ${MIN_VISITS}-${MAX_VISITS} bezoeken.`);

        // Stap 3: Gegevens ophalen en doorsturen (max 5 per run)
        const batch = candidates.slice(0, 5);

        for (const cand of batch) {
            const mRes = await axios.get(`https://api.virtuagym.com/api/v1/club/${CLUB_ID}/member/${cand.id}`, {
                params: { api_key: API_KEY, club_secret: CLUB_SECRET }
            });
            
            const memberData = mRes.data.result;
            const member = Array.isArray(memberData) ? memberData[0] : memberData;

            if (member) {
                const phone = formatPhone(member.mobile || member.phone);
                console.log(`> MATCH: ${member.firstname} | Bezoeken: ${cand.count} | Tel: ${phone || 'GEEN NUMMER'}`);
                
                if (!DRY_RUN && phone && MAKE_WEBHOOK_URL) {
                    await axios.post(MAKE_WEBHOOK_URL, {
                        telefoon: phone,
                        voornaam: member.firstname,
                        member_id: cand.id,
                        bezoeken: cand.count
                    });
                    console.log(`  [WEBHOOK VERSTUURD]`);
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }

        console.log("--- SCAN VOLTOOID ---");
    } catch (e) {
        console.error("FOUT GEBELD:", e.message);
    }
}

runReviewBot();
