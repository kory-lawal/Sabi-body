const phrase = (en, yo, ig, ha, pcm) => ({ en, yo, ig, ha, pcm });

export const COACHING_PHRASES = {
  'camera-body-alignment': {
    'camera-positioning': phrase(
      'Stand where the camera can see the joints needed for this exercise.',
      'Dúró sí ibi tí kámẹ́rà ti lè rí àwọn ibi ara tó ṣe pàtàkì fún eré yìí.',
      'Guzo ebe igwefoto ga-ahụ akụkụ ahụ dị mkpa maka mmega ahụ a.',
      'Tsaya inda kyamara za ta ga sassan jiki da ake buƙata don wannan motsa jikin.',
      'Stand where camera fit see the body parts wey this exercise need.',
    ),
    'body-not-visible': phrase(
      'Move into view so I can follow your movement.',
      'Wọle si ibi ti kamẹra le rii ọ ki n le tọpa gbigbe rẹ.',
      'Bata n’ebe igwefoto ga-ahụ gị ka m nwee ike iso mmegharị gị.',
      'Shiga cikin kallon kyamara don in iya bin motsinka.',
      'Enter the camera view so I fit follow your movement.',
    ),
    aligned: phrase(
      'Your body is aligned.',
      'Ara rẹ wa ni ila to dara.',
      'Ahụ gị kwụ ọtọ nke ọma.',
      'Jikinka yana daidaita.',
      'Your body dey align well.',
    ),
    'adjust-alignment': phrase(
      'Make a small adjustment to your alignment.',
      'Ṣe atunṣe díẹ sí ìdúró ara rẹ.',
      'Hazie ọnọdụ ahụ gị ntakịrị.',
      'Gyara daidaiton jikinka kaɗan.',
      'Adjust your body position small.',
    ),
    'camera-error': phrase(
      'The camera could not start. Check its permission and try again.',
      'Kámẹ́rà kò lè bẹ̀rẹ̀. Ṣàyẹ̀wò àṣẹ rẹ̀ kí o sì tún gbìyànjú.',
      'Igwefoto amaliteghị. Lelee ikike ya ma nwaa ọzọ.',
      'Kyamara ta kasa farawa. Duba izinin ta sannan ka sake gwadawa.',
      'Camera no fit start. Check the permission and try again.',
    ),
    'camera-whole-body': phrase(
      'Position your phone so the camera can see your whole body.',
      'Gbé fóònù rẹ sí ibi tí kámẹ́rà ti lè rí gbogbo ara rẹ.',
      'Debe ekwentị gị ka igwefoto hụ ahụ gị dum.',
      'Sanya wayarka inda kyamara za ta ga jikinka gaba ɗaya.',
      'Put your phone where camera fit see your whole body.',
    ),
    'camera-move-farther-away': phrase(
      'Move a little farther away from the camera.',
      'Lọ síwájú díẹ̀ sí kámẹ́rà.',
      'Gaa n’ihu ntakịrị pụọ na igwefoto.',
      'Matsawa kaɗan daga kyamara.',
      'Move small farther from camera.',
    ),
    'camera-show-head-feet': phrase(
      'Make sure your head and feet are both in view.',
      'Rí i dájú pé orí àti ẹsẹ̀ rẹ wà nínú àwòrán.',
      'Gbaa mbọ hụ na isi na ụkwụ gị abụọ nọ na nlele.',
      'Tabbatar cewa ana ganin kai da ƙafafunka.',
      'Make sure camera fit see your head and feet.',
    ),
    'camera-adjust-position': phrase(
      'Adjust your position until your whole body is visible.',
      'Ṣàtúnṣe ipò rẹ títí gbogbo ara rẹ yóò fi hàn.',
      'Gbanwee ọnọdụ gị ruo mgbe a ga-ahụ ahụ gị dum.',
      'Gyara matsayinka har sai an ga jikinka gaba ɗaya.',
      'Adjust your position until camera fit see your whole body.',
    ),
    'stand-straight': phrase(
      'Stand straight.',
      'Dúró ní gígùn.',
      'Guzo ọtọ.',
      'Tsaya a miƙe.',
      'Stand straight.',
    ),
    'clear-visibility': phrase(
      'I can see you clearly. You are ready.',
      'Mo rí ọ dáadáa. O ti múra.',
      'Ahụrụ m gị nke ọma. Ị dịla njikere.',
      'Ina ganinka sarai. Ka shirya.',
      'I fit see you well. You don ready.',
    ),
  },
  'workout-instructions': {
    ready: phrase(
      'You’re ready. Start moving when you feel comfortable.',
      'O ti setan. Bẹrẹ gbigbe nigbati ara rẹ ba balẹ.',
      'Ị dịla njikere. Malite imegharị ahụ mgbe ahụ gị dị gị mma.',
      'Ka shirya. Fara motsi idan kana jin daɗi.',
      'You don ready. Start to move when your body feel okay.',
    ),
    'move-lower': phrase(
      'Move a little lower.',
      'Sọkalẹ diẹ diẹ.',
      'Kpọda ntakịrị.',
      'Sauko kaɗan.',
      'Go down small.',
    ),
    'return-to-start': phrase(
      'Return to your starting position.',
      'Pada si ipo ibẹrẹ rẹ.',
      'Laghachi n’ọnọdụ mbụ gị.',
      'Koma matsayin farawa.',
      'Go back to where you start.',
    ),
    'alternate-legs': phrase(
      'Use the opposite leg for your next lunge.',
      'Lo ẹsẹ̀ kejì fún lunge tó kàn.',
      'Jiri ụkwụ nke ọzọ mee lunge na-esote.',
      'Yi amfani da ɗayan ƙafar don lunge na gaba.',
      'Use the other leg for your next lunge.',
    ),
    'jack-return-closed': phrase(
      'Bring your feet together and lower your arms.',
      'Dá ẹsẹ̀ rẹ pọ̀ kí o sì sọ ọwọ́ rẹ sílẹ̀.',
      'Kpọkọta ụkwụ gị ma wetuo aka gị.',
      'Haɗa ƙafafunka tare sannan ka sauke hannayenka.',
      'Bring your feet together and lower your hands.',
    ),
    'squat-stand-up': phrase(
      'Stand up tall.',
      'Dìde dúró ní gígùn.',
      'Bilie guzoro ọtọ.',
      'Tashi ka tsaya a miƙe.',
      'Stand up straight.',
    ),
    'workout-start-slowly': phrase(
      'Let’s begin. Start slowly.',
      'Ẹ jẹ́ ká bẹ̀rẹ̀. Bẹ̀rẹ̀ díẹ̀díẹ̀.',
      'Ka anyị bido. Malite nwayọọ.',
      'Mu fara. Fara a hankali.',
      'Make we start. Start small-small.',
    ),
    'instruction-bend-knees': phrase(
      'Bend your knees.',
      'Tẹ eékún rẹ.',
      'Kpọọ ikpere gị.',
      'Lanƙwasa gwiwoyinka.',
      'Bend your knees.',
    ),
    'instruction-keep-back-straight': phrase(
      'Keep your back straight.',
      'Jẹ́ kí ẹ̀yìn rẹ dúró ní gígùn.',
      'Debe azụ gị ka ọ kwụ ọtọ.',
      'Ka bayanka ya miƙe.',
      'Keep your back straight.',
    ),
    'instruction-lower-body': phrase(
      'Lower your body.',
      'Sọ ara rẹ sílẹ̀.',
      'Wedata ahụ gị.',
      'Rage jikinka ƙasa.',
      'Lower your body.',
    ),
    'instruction-push-back-up': phrase(
      'Push back up.',
      'Tì ara rẹ sókè padà.',
      'Kwalite ahụ gị elu ọzọ.',
      'Tura jikinka sama kuma.',
      'Push yourself back up.',
    ),
    'instruction-balance': phrase(
      'Keep your balance.',
      'Pa ìwọ̀ntúnwọ̀nsì rẹ mọ́.',
      'Debe nguzozi gị.',
      'Ka daidaiton jikinka ya tsaya.',
      'Keep your balance.',
    ),
    'instruction-hold-position': phrase(
      'Hold this position.',
      'Dúró sí ipò yìí.',
      'Jide ọnọdụ a.',
      'Riƙe wannan matsayi.',
      'Hold this position.',
    ),
    'instruction-breathe': phrase(
      'Remember to breathe.',
      'Má gbàgbé láti mí.',
      'Echefula iku ume.',
      'Ka tuna da yin numfashi.',
      'Remember to breathe.',
    ),
    'instruction-squats': phrase(
      'Bend your knees and sit your hips back, then stand tall.',
      'Tẹ eékún rẹ kí o sì ti ìgbáròkó rẹ sẹ́yìn, lẹ́yìn náà dìde dúró.',
      'Kpọọ ikpere gị ma tụgharịa úkwù gị azụ, mesịa bilie guzoro ọtọ.',
      'Lanƙwasa gwiwoyinka ka tura duwawunka baya, sannan ka miƙe tsaye.',
      'Bend your knees and push your hips back, then stand up.',
    ),
    'instruction-jumping-jacks': phrase(
      'Jump your feet apart as you raise your arms, then return to the start.',
      'Fo ẹsẹ̀ rẹ sílẹ̀ nígbà tí o bá gbé ọwọ́ rẹ sókè, kí o sì padà sí ìbẹ̀rẹ̀.',
      'Mwụpụ ụkwụ gị n’akụkụ ka ị na-ebuli aka gị elu, mesịa laghachi na mbido.',
      'Yi tsalle ka ware ƙafafunka tare da ɗaga hannayenka, sannan ka koma farko.',
      'Jump your feet apart and raise your hands, then come back to start.',
    ),
    'instruction-plank': phrase(
      'Hold a straight line from your head to your heels.',
      'Di ara rẹ mú ní ìlà gígùn láti orí dé gìgísẹ̀.',
      'Debe ahụ gị n’ahịrị kwụ ọtọ site n’isi ruo n’ikiri ụkwụ.',
      'Riƙe jikinka a miƙe daga kai har diddige.',
      'Hold your body straight from your head reach your heel.',
    ),
    'instruction-push-ups': phrase(
      'Lower your chest with control, then push back up.',
      'Sọ àyà rẹ sílẹ̀ díẹ̀díẹ̀, kí o sì tì ara rẹ sókè padà.',
      'Jiri nwayọọ wedata obi gị, mesịa kwalite ahụ gị elu ọzọ.',
      'Sauke kirjinka a hankali, sannan ka tura jikinka sama.',
      'Lower your chest with control, then push yourself up.',
    ),
    'instruction-sit-ups': phrase(
      'Lift your upper body, then lower back down with control.',
      'Gbé apá òkè ara rẹ sókè, kí o sì sọ ọ́ padà sílẹ̀ díẹ̀díẹ̀.',
      'Welite akụkụ elu ahụ gị, mesịa jiri nwayọọ wedata ya.',
      'Ɗaga saman jikinka, sannan ka sauke shi a hankali.',
      'Lift your upper body, then lower it back down slowly.',
    ),
    'instruction-lunges': phrase(
      'Step forward, bend both knees, then push back to standing.',
      'Tẹ̀ síwájú, tẹ eékún méjèèjì, kí o sì tì ara rẹ padà dúró.',
      'Gaa n’ihu, kpọọ ikpere abụọ, mesịa laghachi n’ọnọdụ guzoro.',
      'Yi gaba, lanƙwasa gwiwoyi biyu, sannan ka koma tsaye.',
      'Step forward, bend both knees, then return to standing.',
    ),
  },
  motivation: {
    'great-job': phrase(
      'Great job!',
      'O ṣe dáadáa!',
      'Ị mere nke ọma!',
      'Ka yi kyau sosai!',
      'You do well!',
    ),
    'keep-going': phrase(
      'Keep going at your own pace.',
      'Tẹsiwaju ni iyara ti o ba ọ mu.',
      'Gaa n’ihu n’ọsọ dị gị mma.',
      'Ci gaba a saurin da ya dace da kai.',
      'Continue with the speed wey feel okay for you.',
    ),
    'energetic-great-job': phrase(
      'Fantastic work! You are moving strong!',
      'Iṣẹ nla! O n ṣe dáadáa gan-an!',
      'Ọrụ mara mma! Ị na-eme nke ọma nke ukwuu!',
      'Madalla ƙwarai! Kana motsi da ƙarfi!',
      'Correct work! You dey move with power!',
    ),
    'energetic-keep-going': phrase(
      'You have got this! Keep that strong rhythm going!',
      'O le ṣe e! Tẹsiwaju pẹlu agbara yẹn!',
      'Ị ga-emeli ya! Jiri ike ahụ gaa n’ihu!',
      'Za ka iya! Ci gaba da wannan ƙwarin gwiwa!',
      'You fit do am! Keep that strong rhythm!',
    ),
    'motivation-encouragement-1': phrase(
      'You are doing well.',
      'O ń ṣe dáadáa.',
      'Ị na-eme nke ọma.',
      'Kana yin kyau.',
      'You dey do well.',
    ),
    'motivation-encouragement-2': phrase(
      'Keep up the good work.',
      'Máa bá iṣẹ́ rere yìí lọ.',
      'Gaa n’ihu n’ọrụ ọma a.',
      'Ci gaba da wannan kyakkyawan aikin.',
      'Continue this good work.',
    ),
    'motivation-encouragement-3': phrase(
      'You are getting stronger.',
      'Agbára rẹ ń pọ̀ sí i.',
      'Ị na-adịwanye ike.',
      'Kana ƙara samun ƙarfi.',
      'Your strength dey increase.',
    ),
    'motivation-encouragement-4': phrase(
      'One step at a time.',
      'Ìgbésẹ̀ kan lẹ́ẹ̀kan.',
      'Were otu nzọụkwụ n’otu oge.',
      'Mataki ɗaya a lokaci guda.',
      'One step at a time.',
    ),
    'motivation-encouragement-5': phrase(
      'Stay steady. You can do this.',
      'Máa dúró ṣinṣin. O lè ṣe é.',
      'Nọgide na-eguzosi ike. Ị ga-emeli ya.',
      'Ka tsaya daram. Za ka iya yin wannan.',
      'Stay steady. You fit do am.',
    ),
    'motivation-encouragement-6': phrase(
      'Your effort is paying off.',
      'Ìsapá rẹ ń so èso.',
      'Mgbalị gị na-amị mkpụrụ.',
      'Ƙoƙarinka yana haifar da sakamako.',
      'Your effort dey bring result.',
    ),
    'motivation-encouragement-7': phrase(
      'Take your time and keep moving.',
      'Máa lo àkókò rẹ, kí o sì máa tẹ̀síwájú.',
      'Were oge gị ma nọgide na-emegharị ahụ.',
      'Ka yi amfani da lokacinka, ka ci gaba da motsi.',
      'Take your time and continue to move.',
    ),
    'motivation-encouragement-8': phrase(
      'Every repetition counts. Keep going.',
      'Gbogbo ìgbà tí o bá ṣe é ṣe pàtàkì. Tẹ̀síwájú.',
      'Mmegharị ọ bụla dị mkpa. Gaa n’ihu.',
      'Kowane maimaitawa yana da muhimmanci. Ci gaba.',
      'Every repetition count. Continue.',
    ),
  },
  progress: {
    welcome: phrase(
      'Welcome. Let us move at a pace that feels good for you.',
      'Ẹ káàbọ̀. Ẹ jẹ́ ká máa rìn ní ìyára tó bá yín mu.',
      'Nnọọ. Ka anyị na-emegharị ahụ n’ọsọ dị gị mma.',
      'Barka da zuwa. Mu motsa jiki a saurin da ya dace da kai.',
      'You are welcome. Make we move at the speed wey feel good for you.',
    ),
    'workout-countdown': phrase(
      'Get ready. Three, two, one, begin!',
      'Múra sílẹ̀. Mẹ́ta, méjì, ọ̀kan, bẹ̀rẹ̀!',
      'Kwadebe onwe gị. Atọ, abụọ, otu, malite!',
      'Yi shiri. Uku, biyu, ɗaya, fara!',
      'Get ready. Three, two, one, make we start!',
    ),
    'workout-started': phrase(
      'Your workout has started.',
      'Eré ìdárayá rẹ ti bẹ̀rẹ̀.',
      'Mmega ahụ gị amalitela.',
      'Motsa jikinka ya fara.',
      'Your workout don start.',
    ),
    'repetition-count': phrase(
      '{count}.',
      '{count}.',
      '{count}.',
      '{count}.',
      '{count}.',
    ),
    'remaining-reps': phrase(
      '{remaining} repetitions to go.',
      'Atunwi {remaining} lo ku.',
      'Mmegharị ahụ {remaining} fọdụrụ.',
      'Maimaitawa {remaining} sun rage.',
      'Na {remaining} repetitions remain.',
    ),
    halfway: phrase(
      'You are halfway there. Keep going at your own pace.',
      'O ti de àárín. Tẹsiwaju ni iyara tó bá ọ mu.',
      'Ị ruru ọkara. Gaa n’ihu n’ọsọ dị gị mma.',
      'Ka kai rabin hanya. Ci gaba a saurin da ya dace da kai.',
      'You don reach halfway. Continue at your own pace.',
    ),
    'final-repetition': phrase(
      'One more repetition. You can do it!',
      'Atunwi kan ṣoṣo lo ku. O lè ṣe é!',
      'Otu mmegharị ahụ fọdụrụ. Ị ga-emeli ya!',
      'Maimaitawa ɗaya ta rage. Za ka iya!',
      'Na one repetition remain. You fit do am!',
    ),
    'milestone-reps': phrase(
      'Nice work — {count} of {target} repetitions complete.',
      'O n ṣe daradara — o ti pari {count} ninu {target} atunwi.',
      'Ị na-eme nke ọma — mmegharị ahụ {count} n’ime {target} emechala.',
      'Kana kokari sosai — ka kammala {count} cikin {target} maimaitawa.',
      'You dey do well — you don finish {count} out of {target} repetitions.',
    ),
    'progress-repetition-summary': phrase(
      '{count} of {target} repetitions complete; {remaining} to go.',
      'O ti pari {count} ninu {target} atunwi; {remaining} lo ku.',
      'Mmegharị ahụ {count} n’ime {target} emechala; {remaining} fọdụrụ.',
      'Ka kammala {count} cikin {target} maimaitawa; {remaining} sun rage.',
      'You don finish {count} out of {target} repetitions; {remaining} remain.',
    ),
    'progress-approaching-target': phrase(
      'You are close to your target. {remaining} repetitions to go.',
      'O ti sún mọ́ ibi tí o fẹ́ dé. Atunwi {remaining} lo ku.',
      'Ị nọ nso n’ebumnuche gị. Mmegharị ahụ {remaining} fọdụrụ.',
      'Ka kusa kai ga burinka. Maimaitawa {remaining} sun rage.',
      'You don near your target. Na {remaining} repetitions remain.',
    ),
    'progress-target-reached': phrase(
      'You reached your target!',
      'O ti dé ibi tí o fẹ́ dé!',
      'Ị ruru ebumnuche gị!',
      'Ka kai ga burinka!',
      'You don reach your target!',
    ),
    'progress-next-exercise': phrase(
      'Next exercise.',
      'Eré ìdárayá tó kàn.',
      'Mmega ahụ na-esote.',
      'Motsa jiki na gaba.',
      'Next exercise.',
    ),
    'workout-paused': phrase(
      'Workout paused. Take your time.',
      'A dá eré dúró. Má ṣe yára.',
      'A kwụsịla mmega ahụ. Were oge gị.',
      'An dakatar da motsa jiki. Ka huta.',
      'Workout don pause. Take your time.',
    ),
    'workout-resumed': phrase(
      'Welcome back. Continue when you are ready.',
      'A kú àbọ̀. Tẹsiwaju nígbà tí o bá ti múra.',
      'Nnọọ azụ. Gaa n’ihu mgbe ị dị njikere.',
      'Barka da dawowa. Ci gaba idan ka shirya.',
      'Welcome back. Continue when you ready.',
    ),
  },
  plank: {
    'plank-hold': phrase(
      'Hold your plank position.',
      'Di ipo plank rẹ mú.',
      'Jide ọnọdụ plank gị.',
      'Riƙe matsayin plank ɗinka.',
      'Hold your plank position.',
    ),
    'plank-keep-body-straight': phrase(
      'Keep your body straight.',
      'Jẹ́ kí ara rẹ dúró ní gígùn.',
      'Debe ahụ gị ka ọ kwụ ọtọ.',
      'Ka jikinka ya miƙe.',
      'Keep your body straight.',
    ),
    'plank-hips-up': phrase(
      'Lift your hips a little.',
      'Gbé ìgbáròkó rẹ sókè díẹ̀.',
      'Welite úkwù gị ntakịrị.',
      'Ɗaga duwawunka kaɗan.',
      'Lift your hips small.',
    ),
    'plank-keep-holding': phrase(
      'Keep holding. You are doing well.',
      'Máa di i mú. O ń ṣe dáadáa.',
      'Nọgide na-ejide ya. Ị na-eme nke ọma.',
      'Ci gaba da riƙewa. Kana yin kyau.',
      'Continue to hold. You dey do well.',
    ),
    'plank-five-seconds-left': phrase(
      'Five seconds left.',
      'Ìṣẹ́jú-àáyá márùn-ún ló kù.',
      'Sekọnd ise fọdụrụ.',
      'Daƙiƙa biyar sun rage.',
      'Five seconds remain.',
    ),
    'plank-countdown-encouragement': phrase(
      'Stay strong. You are nearly there.',
      'Máa lágbára. O ti fẹ́ dé.',
      'Jisie ike. Ị fọrọ obere ka ị rute.',
      'Ka kasance da ƙarfi. Ka kusa kaiwa.',
      'Stay strong. You don near there.',
    ),
    'milestone-plank': phrase(
      'Nice work — {count} seconds of your plank complete.',
      'O n ṣe daradara — o ti di plank fun iṣẹju-aaya {count}.',
      'Ị na-eme nke ọma — i jigidela plank ruo sekọnd {count}.',
      'Kana kokari sosai — ka riƙe plank na daƙiƙa {count}.',
      'You dey do well — you don hold plank for {count} seconds.',
    ),
    'plank-completed': phrase(
      'Excellent hold! You completed {count} seconds. Take a short rest before your next exercise.',
      'O ti parí plank. O dì í mú dáadáa!',
      'Emechaala plank. Ị jidere ya nke ọma!',
      'An kammala plank. Ka riƙe shi da kyau!',
      'Plank don finish. You hold am well!',
    ),
  },
  completion: {
    'exercise-completed': phrase(
      "Excellent work! You've completed all {count} repetitions. Take a short rest before your next exercise.",
      'O ti pari adaṣe. O ṣeun!',
      'Emechaala mgbatị ahụ. Ị mere nke ọma!',
      'Ka gama motsa jiki. Madalla!',
      'You don finish the exercise. Well done!',
    ),
    'squat-completed': phrase(
      'Squat complete. Well done!',
      'O ti parí squat. O ṣe dáadáa!',
      'Emechaala squat. Ị mere nke ọma!',
      'An kammala squat. Madalla!',
      'Squat don finish. You do well!',
    ),
    'jumping-jack-completed': phrase(
      'Jumping jack complete. Well done!',
      'O ti parí jumping jack. O ṣe dáadáa!',
      'Emechaala jumping jack. Ị mere nke ọma!',
      'An kammala jumping jack. Madalla!',
      'Jumping jack don finish. You do well!',
    ),
    'workout-completed': phrase(
      'Workout complete.',
      'Eré ìdárayá ti parí.',
      'Mmega ahụ agwụla.',
      'An kammala motsa jiki.',
      'Workout don finish.',
    ),
    congratulations: phrase(
      'Congratulations!',
      'Ẹ kú oríire!',
      'Ekele!',
      'Taya murna!',
      'Congratulations!',
    ),
    'excellent-work': phrase(
      'Excellent work!',
      'Iṣẹ́ rẹ dára púpọ̀!',
      'Ọrụ gị dị ezigbo mma!',
      'Kyakkyawan aiki!',
      'You do excellent work!',
    ),
    rest: phrase(
      'Take a rest.',
      'Sinmi díẹ̀.',
      'Were obere ezumike.',
      'Ka huta.',
      'Take small rest.',
    ),
    'proud-effort': phrase(
      'Be proud of the effort you put in.',
      'Máa fi ìsapá rẹ yangàn.',
      'Nwee nganga maka mbọ ị gbara.',
      'Yi alfahari da ƙoƙarin da ka yi.',
      'You fit proud of the effort wey you put in.',
    ),
    'energetic-exercise-completed': phrase(
      'Amazing work! You completed your workout!',
      'Iṣẹ iyanu! O ti pari adaṣe rẹ!',
      'Ọrụ dị ịtụnanya! Ị mechara mgbatị ahụ gị!',
      'Aiki mai ban sha’awa! Ka kammala motsa jikinka!',
      'Amazing work! You don finish your workout!',
    ),
  },
};

export const EXERCISE_INSTRUCTION_IDS = {
  squats: 'instruction-squats',
  'jumping-jacks': 'instruction-jumping-jacks',
  plank: 'instruction-plank',
  'push-ups': 'instruction-push-ups',
  'sit-ups': 'instruction-sit-ups',
  lunges: 'instruction-lunges',
};

const MESSAGE_CATALOG = Object.create(null);
for (const phrases of Object.values(COACHING_PHRASES)) {
  for (const [messageId, translations] of Object.entries(phrases)) {
    MESSAGE_CATALOG[messageId] = translations;
  }
}

const UNKNOWN_MESSAGE_FALLBACK = 'Keep going and follow the on-screen guidance.';
const INTERPOLATION_KEYS = new Set(['count', 'remaining', 'target']);

export function hasCoachingMessage(messageId) {
  return Object.hasOwn(MESSAGE_CATALOG, messageId);
}

export function interpolateCoachingTemplate(template, parameters = {}) {
  return template.replace(/\{([a-z]+)\}/g, (placeholder, key) => {
    if (
      !INTERPOLATION_KEYS.has(key)
      || !Object.hasOwn(parameters, key)
      || typeof parameters[key] !== 'number'
      || !Number.isFinite(parameters[key])
    ) {
      return placeholder;
    }
    return String(parameters[key]);
  });
}

export function translateCoachingMessage(messageId, languageCode, parameters = {}) {
  if (!hasCoachingMessage(messageId)) {
    return {
      text: UNKNOWN_MESSAGE_FALLBACK,
      isFallback: true,
      translationStatus: 'unavailable',
    };
  }

  const translations = MESSAGE_CATALOG[messageId];
  const hasLocalizedMessage = Object.hasOwn(translations, languageCode);
  const localizedText = hasLocalizedMessage ? translations[languageCode] : translations.en;
  const text = interpolateCoachingTemplate(localizedText, parameters);

  return {
    text,
    isFallback: languageCode !== 'en' && !hasLocalizedMessage,
    translationStatus: languageCode === 'en' ? 'verified' : 'unverified',
  };
}
