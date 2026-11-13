const ENGLISH_MESSAGES = {
  welcome: 'Welcome. Let us move at a pace that feels good for you.',
  'camera-positioning': 'Stand where the camera can see the joints needed for this exercise.',
  ready: 'You’re ready. Start moving when you feel comfortable.',
  'body-not-visible': 'Move into view so I can follow your movement.',
  'workout-countdown': 'Get ready. Three, two, one, begin!',
  'move-lower': 'Move a little lower.',
  'return-to-start': 'Return to your starting position.',
  'alternate-legs': 'Use the opposite leg for your next lunge.',
  'great-job': 'Great job!',
  'keep-going': 'Keep going at your own pace.',
  'repetition-count': '{count}.',
  'remaining-reps': '{remaining} repetitions to go.',
  halfway: 'You are halfway there. Keep going at your own pace.',
  'final-repetition': 'One more repetition. You can do it!',
  'workout-paused': 'Workout paused. Take your time.',
  'workout-resumed': 'Welcome back. Continue when you are ready.',
  aligned: 'Your body is aligned.',
  'adjust-alignment': 'Make a small adjustment to your alignment.',
  'camera-error': 'The camera could not start. Check its permission and try again.',
  'exercise-completed': 'Exercise completed. Well done!',
  'test-count-sequence': 'One, two, three, four, five, six, seven, eight, nine, ten.',
  'test-positioning': 'Stand a little farther back so your full body stays in view.',
  'test-completion': 'Congratulations. You completed your workout. Well done!',
  'milestone-reps': 'Nice work — {count} of {target} repetitions complete.',
  'milestone-plank': 'Nice work — {count} seconds of your plank complete.',
  'energetic-great-job': 'Fantastic work! You are moving strong!',
  'energetic-keep-going': 'You have got this! Keep that strong rhythm going!',
  'energetic-exercise-completed': 'Amazing work! You completed your workout!',
  'energetic-milestone-reps': 'Brilliant progress! {count} of {target} repetitions done!',
  'energetic-milestone-plank': 'Fantastic hold! You reached {count} seconds!',
};

const TRANSLATIONS = {
  yo: {
    welcome: 'Ẹ káàbọ̀. Ẹ jẹ́ ká máa rìn ní ìyára tó bá yín mu.',
    'camera-positioning': 'Dúró sí ibi tí kámẹ́rà ti lè rí àwọn ibi ara tó ṣe pàtàkì fún eré yìí.',
    ready: 'O ti setan. Bẹrẹ gbigbe nigbati ara rẹ ba balẹ.',
    'body-not-visible': 'Wọle si ibi ti kamẹra le rii ọ ki n le tọpa gbigbe rẹ.',
    'workout-countdown': 'Múra sílẹ̀. Mẹ́ta, méjì, ọ̀kan, bẹ̀rẹ̀!',
    'move-lower': 'Sọkalẹ diẹ diẹ.',
    'return-to-start': 'Pada si ipo ibẹrẹ rẹ.',
    'great-job': 'O ṣe dáadáa!',
    'keep-going': 'Tẹsiwaju ni iyara ti o ba ọ mu.',
    'repetition-count': '{count}.',
    'remaining-reps': 'Atunwi {remaining} lo ku.',
    halfway: 'O ti de àárín. Tẹsiwaju ni iyara tó bá ọ mu.',
    'final-repetition': 'Atunwi kan ṣoṣo lo ku. O lè ṣe é!',
    'workout-paused': 'A dá eré dúró. Má ṣe yára.',
    'workout-resumed': 'A kú àbọ̀. Tẹsiwaju nígbà tí o bá ti múra.',
    aligned: 'Ara rẹ wa ni ila to dara.',
    'adjust-alignment': 'Ṣe atunṣe díẹ sí ìdúró ara rẹ.',
    'exercise-completed': 'O ti pari adaṣe. O ṣeun!',
    'test-count-sequence': 'Ọ̀kan, méjì, mẹ́ta, mẹ́rin, márùn-ún, mẹ́fà, méje, mẹ́jọ, mẹ́sàn-án, mẹ́wàá.',
    'test-positioning': 'Padà sẹ́yìn díẹ̀ kí gbogbo ara rẹ lè wà nínú àwòrán.',
    'test-completion': 'Ẹ kú oríire. O ti parí eré rẹ. O ṣe dáadáa!',
    'milestone-reps': 'O n ṣe daradara — o ti pari {count} ninu {target} atunwi.',
    'milestone-plank': 'O n ṣe daradara — o ti di plank fun iṣẹju-aaya {count}.',
    'energetic-great-job': 'Iṣẹ nla! O n ṣe dáadáa gan-an!',
    'energetic-keep-going': 'O le ṣe e! Tẹsiwaju pẹlu agbara yẹn!',
    'energetic-exercise-completed': 'Iṣẹ iyanu! O ti pari adaṣe rẹ!',
    'energetic-milestone-reps': 'Ilọsiwaju nla! O ti pari {count} ninu {target} atunwi!',
    'energetic-milestone-plank': 'Agbara nla! O ti de iṣẹju-aaya {count}!',
  },
  ig: {
    welcome: 'Nnọọ. Ka anyị na-emegharị ahụ n’ọsọ dị gị mma.',
    'camera-positioning': 'Guzo ebe igwefoto ga-ahụ akụkụ ahụ dị mkpa maka mmega ahụ a.',
    ready: 'Ị dịla njikere. Malite imegharị ahụ mgbe ahụ gị dị gị mma.',
    'body-not-visible': 'Bata n’ebe igwefoto ga-ahụ gị ka m nwee ike iso mmegharị gị.',
    'workout-countdown': 'Kwadebe onwe gị. Atọ, abụọ, otu, malite!',
    'move-lower': 'Kpọda ntakịrị.',
    'return-to-start': 'Laghachi n’ọnọdụ mbụ gị.',
    'great-job': 'Ị mere nke ọma!',
    'keep-going': 'Gaa n’ihu n’ọsọ dị gị mma.',
    'repetition-count': '{count}.',
    'remaining-reps': 'Mmegharị ahụ {remaining} fọdụrụ.',
    halfway: 'Ị ruru ọkara. Gaa n’ihu n’ọsọ dị gị mma.',
    'final-repetition': 'Otu mmegharị ahụ fọdụrụ. Ị ga-emeli ya!',
    'workout-paused': 'A kwụsịla mmega ahụ. Were oge gị.',
    'workout-resumed': 'Nnọọ azụ. Gaa n’ihu mgbe ị dị njikere.',
    aligned: 'Ahụ gị kwụ ọtọ nke ọma.',
    'adjust-alignment': 'Hazie ọnọdụ ahụ gị ntakịrị.',
    'exercise-completed': 'Emechaala mgbatị ahụ. Ị mere nke ọma!',
    'test-count-sequence': 'Otu, abụọ, atọ, anọ, ise, isii, asaa, asatọ, itoolu, iri.',
    'test-positioning': 'Laghachi azụ ntakịrị ka igwefoto hụ ahụ gị dum.',
    'test-completion': 'Ekele. Ị mechara mgbatị ahụ gị. Ị mere nke ọma!',
    'milestone-reps': 'Ị na-eme nke ọma — imegharị ahụ {count} n’ime {target} emechala.',
    'milestone-plank': 'Ị na-eme nke ọma — i jigidela plank ruo sekọnd {count}.',
    'energetic-great-job': 'Ọrụ mara mma! Ị na-eme nke ọma nke ukwuu!',
    'energetic-keep-going': 'Ị ga-emeli ya! Jiri ike ahụ gaa n’ihu!',
    'energetic-exercise-completed': 'Ọrụ dị ịtụnanya! Ị mechara mgbatị ahụ gị!',
    'energetic-milestone-reps': 'Ọganihu mara mma! Imegharị ahụ {count} n’ime {target} emechala!',
    'energetic-milestone-plank': 'Ị jigidere nke ọma! Ị ruru sekọnd {count}!',
  },
  ha: {
    welcome: 'Barka da zuwa. Mu motsa jiki a saurin da ya dace da kai.',
    'camera-positioning': 'Tsaya inda kyamara za ta ga sassan jiki da ake buƙata don wannan motsa jikin.',
    ready: 'Ka shirya. Fara motsi idan kana jin daɗi.',
    'body-not-visible': 'Shiga cikin kallon kyamara don in iya bin motsinka.',
    'workout-countdown': 'Yi shiri. Uku, biyu, ɗaya, fara!',
    'move-lower': 'Sauko kaɗan.',
    'return-to-start': 'Koma matsayin farawa.',
    'great-job': 'Ka yi kyau sosai!',
    'keep-going': 'Ci gaba a saurin da ya dace da kai.',
    'repetition-count': '{count}.',
    'remaining-reps': 'Maimaitawa {remaining} sun rage.',
    halfway: 'Ka kai rabin hanya. Ci gaba a saurin da ya dace da kai.',
    'final-repetition': 'Maimaitawa ɗaya ta rage. Za ka iya!',
    'workout-paused': 'An dakatar da motsa jiki. Ka huta.',
    'workout-resumed': 'Barka da dawowa. Ci gaba idan ka shirya.',
    aligned: 'Jikinka yana daidaita.',
    'adjust-alignment': 'Gyara daidaiton jikinka kaɗan.',
    'exercise-completed': 'Ka gama motsa jiki. Madalla!',
    'test-count-sequence': 'Ɗaya, biyu, uku, huɗu, biyar, shida, bakwai, takwas, tara, goma.',
    'test-positioning': 'Ja da baya kaɗan domin kyamara ta ga jikinka gaba ɗaya.',
    'test-completion': 'Taya murna. Ka kammala motsa jikinka. Madalla!',
    'milestone-reps': 'Kana kokari sosai — ka kammala {count} cikin {target} maimaitawa.',
    'milestone-plank': 'Kana kokari sosai — ka riƙe plank na daƙiƙa {count}.',
    'energetic-great-job': 'Madalla ƙwarai! Kana motsi da ƙarfi!',
    'energetic-keep-going': 'Za ka iya! Ci gaba da wannan ƙwarin gwiwa!',
    'energetic-exercise-completed': 'Aiki mai ban sha’awa! Ka kammala motsa jikinka!',
    'energetic-milestone-reps': 'Babban ci gaba! Ka kammala maimaitawa {count} cikin {target}!',
    'energetic-milestone-plank': 'Ka riƙe da kyau! Ka kai daƙiƙa {count}!',
  },
  pcm: {
    welcome: 'You are welcome. Make we move at the speed wey feel good for you.',
    'camera-positioning': 'Stand where camera fit see the body parts wey this exercise need.',
    ready: 'You don ready. Start to move when your body feel okay.',
    'body-not-visible': 'Enter the camera view so I fit follow your movement.',
    'workout-countdown': 'Get ready. Three, two, one, make we start!',
    'move-lower': 'Go down small.',
    'return-to-start': 'Go back to where you start.',
    'great-job': 'You do well!',
    'keep-going': 'Continue with the speed wey feel okay for you.',
    'repetition-count': '{count}.',
    'remaining-reps': 'Na {remaining} repetitions remain.',
    halfway: 'You don reach halfway. Continue at your own pace.',
    'final-repetition': 'Na one repetition remain. You fit do am!',
    'workout-paused': 'Workout don pause. Take your time.',
    'workout-resumed': 'Welcome back. Continue when you ready.',
    aligned: 'Your body dey align well.',
    'adjust-alignment': 'Adjust your body position small.',
    'exercise-completed': 'You don finish the exercise. Well done!',
    'test-count-sequence': 'One, two, three, four, five, six, seven, eight, nine, ten.',
    'test-positioning': 'Move back small so camera fit see your whole body.',
    'test-completion': 'Congratulations. You don finish your workout. Well done!',
    'milestone-reps': 'You dey do well — you don finish {count} out of {target} repetitions.',
    'milestone-plank': 'You dey do well — you don hold plank for {count} seconds.',
    'energetic-great-job': 'Correct work! You dey move with power!',
    'energetic-keep-going': 'You fit do am! Keep that strong rhythm!',
    'energetic-exercise-completed': 'Amazing work! You don finish your workout!',
    'energetic-milestone-reps': 'Better progress! You don finish {count} out of {target} repetitions!',
    'energetic-milestone-plank': 'Strong hold! You don reach {count} seconds!',
  },
};

const UNKNOWN_MESSAGE_FALLBACK = 'Keep going and follow the on-screen guidance.';
const INTERPOLATION_KEYS = new Set(['count', 'remaining', 'target']);

export function hasCoachingMessage(messageId) {
  return Object.hasOwn(ENGLISH_MESSAGES, messageId);
}

export function translateCoachingMessage(messageId, languageCode, parameters = {}) {
  if (!hasCoachingMessage(messageId)) {
    return {
      text: UNKNOWN_MESSAGE_FALLBACK,
      isFallback: true,
      translationStatus: 'unavailable',
    };
  }

  const englishText = ENGLISH_MESSAGES[messageId];
  const languageMessages = TRANSLATIONS[languageCode];
  const hasLocalizedMessage = Boolean(languageMessages && Object.hasOwn(languageMessages, messageId));
  const localizedText = hasLocalizedMessage
    ? languageMessages[messageId]
    : englishText;
  const text = localizedText.replace(/\{([a-z]+)\}/g, (placeholder, key) => {
    if (!INTERPOLATION_KEYS.has(key) || !Object.hasOwn(parameters, key)) {
      return placeholder;
    }
    return String(parameters[key]);
  });

  return {
    text,
    isFallback: languageCode !== 'en' && !hasLocalizedMessage,
    translationStatus: languageCode === 'en' ? 'verified' : 'unverified',
  };
}