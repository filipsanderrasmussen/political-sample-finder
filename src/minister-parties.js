// Fallback for minister speeches where Folketingets XML omits GroupNameShort.
// Names and political parties are documented in Statsministeriet's cabinet lists.
// Government II: https://regeringen.dk/om-regeringen/regeringer-siden-1848/regeringen-mette-frederiksen-ii/
// Government III: https://regeringen.dk/om-regeringen/regeringer-siden-1848/regeringen-mette-frederiksen-iii/
// Use only when the speech has no explicit party. Period-bound to avoid
// applying later cabinet affiliations to speeches from earlier governments.
const CABINETS=[
  {
    from:"2024-11-08",to:"2026-06-03",
    parties:{
      S:["Mette Frederiksen","Nicolai Wammen","Peter Hummelgaard","Morten Bødskov",
         "Magnus Heunicke","Sophie Hæstorp Andersen","Ane Halsboe-Jørgensen",
         "Mattias Tesfaye","Kaare Dybvad Bek","Jeppe Bruus","Rasmus Stoklund"],
      V:["Troels Lund Poulsen","Sophie Løhde","Jacob Jensen","Thomas Danielsen",
         "Marie Bjerre","Stephanie Lose","Morten Dahlin","Torsten Schack Pedersen"],
      M:["Lars Løkke Rasmussen","Jakob Engel-Schmidt","Christina Egelund",
         "Caroline Stage Olsen","Mette Kierkgaard","Henrik Hasling Frandsen",
         "Henrik Frandsen","Lars Aagaard"]
    }
  },
  {
    from:"2026-06-03",to:null,
    parties:{
      S:["Mette Frederiksen","Peter Hummelgaard","Nicolai Wammen","Morten Bødskov",
         "Magnus Heunicke","Ane Halsboe-Jørgensen","Jeppe Bruus",
         "Ida Auken","Christian Rabjerg Madsen"],
      SF:["Pia Olsen Dyhr","Signe Munk","Lisbeth Bech-Nielsen",
          "Jacob Mark","Maria Reumert Gjerding","Karina Lorentzen Dehnhardt"],
      M:["Lars Løkke Rasmussen","Christina Egelund","Jakob Engel-Schmidt",
         "Monika Rubin","Monica Rubin"],
      RV:["Martin Lidegaard","Samira Nawa","Zenia Stampe"]
    }
  }
];

export function inferredParty(speaker,date){
  const cabinet=CABINETS.find(c=>date>=c.from && (!c.to||date<c.to));
  if(!cabinet)return null;
  for(const [party,names] of Object.entries(cabinet.parties)){
    if(names.includes(speaker))return party;
  }
  return null;
}

// Construct a bounded, parameterized SQL predicate to filter BEFORE pagination.
// No per-result scans or expensive joins against the full speeches table.
export function ministerPartyPredicate(selectedParties){
  const conditions=[],values=[];
  for(const cabinet of CABINETS){
    const names=[...new Set(selectedParties.flatMap(p=>cabinet.parties[p]||[]))];
    if(!names.length)continue;
    const bounds=cabinet.to?"m.date>=? AND m.date<?":"m.date>=?";
    conditions.push("("+bounds+" AND s.speaker IN ("+names.map(()=>"?").join(",")+"))");
    values.push(cabinet.from,...(cabinet.to?[cabinet.to]:[]),...names);
  }
  return {sql:conditions.join(" OR "),values};
}
