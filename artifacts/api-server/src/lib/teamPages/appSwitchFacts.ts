// The twenty starter facts in English, as the app shows them, for the App
// switches page (SYC-383): staff need the words to decide whether to show a
// fact. A copy of the English block in artifacts/cat-spotter/lib/i18n.ts; a
// test (appSwitchFacts.test.ts) fails if the two drift apart.

export interface FactWords {
  id: string;
  text: string;
}

export const FACT_WORDS: readonly FactWords[] = [
  { id: "fact.earTip", text: "The flat top on the ear in this photo is a clipped tip: the sign a cat is sterilised. The vet trims it while she's asleep. On Syros it's usually the left ear." },
  { id: "fact.litters", text: "One unsterilised female can have two or three litters a year, and her daughters can be pregnant themselves from as young as four months." },
  { id: "fact.disease", text: "Sterilised cats fight and roam less, so they're less likely to catch or pass on diseases spread by bites, like FIV, which doesn't affect people." },
  { id: "fact.backHome", text: "After sterilisation, most street cats go back to exactly where they were found: their own patch, their own colony, the people who feed them." },
  { id: "fact.vacuum", text: "Take cats away from a place with food and shelter, and new cats often move in. Sterilising them instead aims for a settled colony that stops growing." },
  { id: "fact.cost", text: "Sterilising one cat costs Syros Cats €50–60. It stops that cat adding to the street-cat population." },
  { id: "fact.milk", text: "Most grown-up cats digest milk badly, so a saucer of milk often means an upset stomach. Fresh water is what they need." },
  { id: "fact.leftovers", text: "Onions, garlic and chocolate are poisonous to cats. Cooked bones, cured meat and salty leftovers can hurt them too. Leftovers aren't cat food." },
  { id: "fact.water", text: "See a dry water bowl at a feeding spot? Topping it up helps, especially in summer. Food is best left to the people who feed the cats regularly." },
  { id: "fact.hiss", text: "A hissing cat isn't being nasty. It's frightened and asking for space. Step back and let it be." },
  { id: "fact.dontPickUp", text: "Even a friendly street cat can panic, scratch or bite if you pick it up. Let it come to you, or simply admire it where it is." },
  { id: "fact.kittensAlone", text: "Kittens on their own? Their mother has usually just gone for food. Don't pick them up; watch from a distance. If they look cold, hurt or ill, report them in the app." },
  { id: "fact.tortie", text: "Almost every tortoiseshell or calico cat is female. The gene for orange fur sits on the X chromosome, with black as its alternative, so showing both takes two Xs." },
  { id: "fact.whiteBlue", text: "Many all-white cats with two blue eyes are born deaf. If one doesn't turn when you come near, it may not have heard you: stay where it can see you." },
  { id: "fact.slowBlink", text: "Try a slow blink, from a distance. A 2020 study found cats often slow-blink back, and seem more at ease with people who do it." },
  { id: "fact.tailUp", text: "A tail held straight up is a cat's friendly hello. A tail tucked low, or fur standing on end, means give it room." },
  { id: "fact.purr", text: "Cats purr when they're content, but also when they're stressed, hurt or giving birth. A purr can be a cat calming itself down." },
  { id: "fact.kittenEyes", text: "Kittens' eyes open blue. Their real colour comes through over the first few months, so a blue-eyed kitten may grow up green or gold." },
  { id: "fact.colonyFemales", text: "A street colony often grows around related females: mothers, daughters, sisters. They may even help look after each other's kittens." },
  { id: "fact.cantTell", text: "“Can’t tell” is a good answer. A wrong guess can make a cat look sterilised when it isn’t." },
];
