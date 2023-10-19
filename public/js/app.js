/* global OT SAMPLE_SERVER_BASE_URL */

let apiKey;
let sessionId;
let token;
let openAISecret;
let publisher;
let subscriber;
let captions;
let voices = window.speechSynthesis.getVoices();
let abortController = null;

const messages = [
  {
    'role': 'system',
    'content': "You are a participant called Sushi in a live call with someone. Speak concisely as if you're having a one on one conversation with someone. " // Prompt engineering for AI assistant
  }
];
const greetingMessage = 'Hello there! My name is Sushi.';

// clears after a set amount of time
let captionsRemovalTimer;

const captionsStartBtn = document.querySelector('#start');
const captionsStopBtn = document.querySelector('#stop');

if (speechSynthesis.onvoiceschanged !== undefined)
  speechSynthesis.onvoiceschanged = updateVoices;

function updateVoices() {
  voices = window.speechSynthesis.getVoices();
}

function handleError(error) {
  if (error) {
    console.error(error);
  }
}

async function initializeSession() {
  let session = OT.initSession(apiKey, sessionId);

  // Subscribe to a newly created stream
  session.on('streamCreated', async (event) => {
    const subscriberOptions = {
      insertMode: 'append',
      width: '100%',
      height: '100%',
      testNetwork: true,
    };
    subscriber = session.subscribe(event.stream, 'subscriber', subscriberOptions, handleError);

    // add captions to the subscriber object
    try {
      await subscriber.subscribeToCaptions(true);
    } catch (err) {
      console.warn(err);
    }

    subscriber.on('captionReceived', (event) => {
      if (!captions){
        // Client didn't initiate the captions. Remove controls.
        captionsStartBtn.style.display = 'none';
        captionsStopBtn.style.display = 'none';
      }
      const captionText = event.caption;
      const subscriberContainer = OT.subscribers.find().element;
      displayCaptions(captionText, 'OT_widget-container', subscriberContainer);
    });
  });

  session.on('sessionDisconnected', (event) => {
    console.log('You were disconnected from the session.', event.reason);
  });

  // Connect to the session
  session.connect(token, (error) => {
    if (error) {
      handleError(error);
    } else {
      // If the connection is successful, initialize a publisher and publish to the session
      const publisherOptions = {
        insertMode: 'append',
        width: '100%',
        height: '100%',
        publishCaptions: true,
      };
      publisher = OT.initPublisher('publisher', publisherOptions, (err) => {
        if (err) {
          handleError(err);
        } else {
          session.publish(publisher, () => {
            if (error) {
              console.error(error);
            } else {
              const captionOnlySub = session.subscribe(
                publisher.stream,
                document.createElement('div'),
                {
                  audioVolume: 0
                },
              );
              speakText(greetingMessage);
              captionOnlySub.on('captionReceived', async (event) => {
                console.log('Event.captions', event.caption)
                if (event.isFinal) {
                  stopAiGenerator();
                  startAiGenerator(event.caption)
                }
              });
            }
          });
        }
      });
    }
  });
}

async function postData(url='', data={}){
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    if (!response.ok){
      throw new Error('error getting data!');
    }
    return response.json();
  }
  catch (error){
    handleError(error);
  }
}

function stopAiGenerator() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  window.speechSynthesis.cancel();
}

function animateVoiceSynthesis() {
  let element;

  for (let i = 1; i < 10; i++) {
    element = document.getElementById(`Line_${i}`);
    if (element) {
      element.classList.add('animate');
    }
  }
}

function stopAnimateVoiceSynthesis() {
  let element;

  for (let i = 1; i < 10; i++) {
    element = document.getElementById(`Line_${i}`);
    if (element) {
      element.classList.remove('animate');
    }
  }
}

function displayCaptions(captionText, className, container = document) {
  const [subscriberWidget] = container.getElementsByClassName(className);
  const oldCaptionBox = subscriberWidget.querySelector('.caption-box');
  if (oldCaptionBox) oldCaptionBox.remove();

  const captionBox = document.createElement('div');
  captionBox.classList.add('caption-box');
  captionBox.textContent = captionText;

  // remove the captions after 5 seconds
  const removalTimerDuration = 5 * 1000;
  clearTimeout(captionsRemovalTimer);
  captionsRemovalTimer = setTimeout(() => {
    captionBox.textContent = '';
  }, removalTimerDuration);

  subscriberWidget.appendChild(captionBox);
}

function speakText(text) {
  let captions = '';
  const utterThis = new SpeechSynthesisUtterance(text);

  utterThis.voice = voices.find((v) => v.name.includes('Samantha'));

  utterThis.onboundary = (event) => {
    captions += `${event.utterance.text.substring(event.charIndex, event.charIndex + event.charLength)} `;
    displayCaptions(captions, 'ai-assistant');
  };

  utterThis.onstart = () => {
    animateVoiceSynthesis();
  };

  utterThis.onend = function() {
    stopAnimateVoiceSynthesis();
  };

  window.speechSynthesis.speak(utterThis);
}

async function startAiGenerator(message) {
  let aiText = '';
  let utterableText = ''

  abortController = new AbortController();
  const userMessage = {
    'role': 'user',
    'content': message
  }

  const reqBody = {
    messages: [...messages, userMessage],
    temperature: 1,
    max_tokens: 256,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    model: 'gpt-3.5-turbo',
    stream: true
  };

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      headers: {
        'Authorization': `Bearer ${openAISecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(reqBody),
      method: 'POST',
      signal: abortController.signal
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    while (true) {
      const chunk = await reader.read();
      const { done, value } = chunk;
      if (done) {
        break;
      }

      const decodedChunk = decoder.decode(value);
      const lines = decodedChunk.split('\n');
      const parsedLines = lines
        .map(l => l.replace(/^data: /, '').trim())
        .filter(l => l !== '' && l !== '[DONE]')
        .map(l => JSON.parse(l));
      for (const line of parsedLines) {
        const textChunk = line?.choices[0]?.delta?.content;
        if (textChunk) {
          utterableText += textChunk
          if (textChunk.match(/[.!?:,]$/)) {
            speakText(utterableText);
            utterableText = '';
          }
          aiText += textChunk;
        }
      }
    }
  } catch (e) {
    console.log(e);
  }
  messages.push(userMessage);
  messages.push({
    content: aiText,
    role: 'assistant'
  })

  return aiText;
}

async function startCaptions(){
  try {
    captions = await postData(SAMPLE_SERVER_BASE_URL +'/captions/start',{sessionId, token});
    captionsStartBtn.style.display = 'none';
    captionsStopBtn.style.display = 'inline';
  }
  catch(error){
    handleError(error);
  }
}

async function stopCaptions(){
  try {
    captions = await postData(`${SAMPLE_SERVER_BASE_URL}/captions/${captions.id}/stop`,{});
    captionsStartBtn.style.display = 'none';
    captionsStopBtn.style.display = 'inline';
  }
  catch(error){
    captionsStartBtn.style.display = 'inline';
    captionsStopBtn.style.display = 'none';
    handleError(error);
  }
}

captionsStartBtn.addEventListener('click', startCaptions, false);
captionsStopBtn.addEventListener('click', stopCaptions, false);

// See the config.js file.
if (SAMPLE_SERVER_BASE_URL) {
  // Make a GET request to get the OpenTok API key, session ID, and token from the server
  fetch(SAMPLE_SERVER_BASE_URL + '/session')
  .then((response) => response.json())
  .then((json) => {
    apiKey = json.apiKey;
    sessionId = json.sessionId;
    token = json.token;
    openAISecret = json.openAISecret;
    // Initialize an OpenTok Session object
    initializeSession();
  }).catch((error) => {
    handleError(error);
    alert('Failed to get opentok sessionId and token. Make sure you have updated the config.js file.');
  });
}
