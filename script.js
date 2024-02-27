document.addEventListener('DOMContentLoaded', function() {
    const form = document.querySelector('form');
    form.addEventListener('submit', sinedays);
});

function sinedays(event) {
    event.preventDefault();
    const birthdayInput = document.getElementById('birthday');
    const resultElement = document.getElementById('result');
    const birthday = new Date(birthdayInput.value);
    const today = new Date();

    // Clear previous results
    resultElement.innerHTML = '';
    resultElement.classList.remove('error', 'success');

    if (!birthdayInput.value) {
        displayMessage("Please enter your birthday.", "", 'error');
        return;
    }
    if (birthday > today) {
        displayMessage("Please enter a date that is not in the future.", "", 'error');
        return;
    }

    const differenceInTime = today.getTime() - birthday.getTime();
    const differenceInDays = differenceInTime / (1000 * 3600 * 24);
    const daysInSine = differenceInDays / 18;
    const fractionalPart = daysInSine % 1;
    let mappedFraction = Math.round(fractionalPart * 18);
    mappedFraction = mappedFraction === 0 ? 18 : mappedFraction;

    const dayDetails = [
        { day: 1, phrase: "Day 1: Fresh beginnings. Take the first step on new ventures with confidence.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/main/Day1.jpeg?raw=true },
        { day: 2, phrase: "Day 2: Build momentum. Great day for pushing forward with your plans.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/main/Day2.jpeg?raw=true" },
        { day: 3, phrase: "Day 3: Creativity peaks. Let your imagination lead the way.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/main/Day3.jpeg?raw=true" },
        { day: 4, phrase: "Day 4: Social connections flourish. Reach out to those around you.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/main/Day4.jpeg?raw=true" },
        { day: 5, phrase: "Day 5: A day of productivity. Focus on tasks that need completion.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/main/Day5.jpeg?raw=true" },
        { day: 6, phrase: "Day 6: Balance is key today. Find harmony in your activities.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/main/Day6.jpeg?raw=true" },
        { day: 7, phrase: "Day 7: Insights emerge. Pay attention to your intuition.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/main/Day7.jpeg?raw=true" },
        { day: 8, phrase: "Day 8: Challenges may arise. Stand firm and face them head-on.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/main/Day8.jpeg?raw=true" },
        { day: 9, phrase: "Day 9: Transition day. Prepare to reflect as the wave dips.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/main/Day9.jpeg?raw=true" },
        { day: 10, phrase: "Day 10: Reflection begins. Look inward for growth opportunities.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/main/Day10.jpeg?raw=true" },
        { day: 11, phrase: "Day 11: Rest and recharge. Allow yourself time to relax.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/main/Day11.jpeg?raw=true" },
        { day: 12, phrase: "Day 12: Reevaluate your path. Make adjustments as needed.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/main/Day12.jpeg?raw=true" },
        { day: 13, phrase: "Day 13: Release what no longer serves you. It's a day for letting go.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/main/Day13.jpeg?raw=true" },
        { day: 14, phrase: "Day 14: Inner work is favored. Dive deep into personal development.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/main/Day14.jpeg?raw=true" },
        { day: 15, phrase: "Day 15: Healing energies are strong. Embrace self-care.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/main/Day15.jpeg?raw=true" },
        { day: 16, phrase: "Day 16: Begin to look outward again. Plan for the next positive wave.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/main/Day16.jpeg?raw=true" },
        { day: 17, phrase: "Day 17: Energy starts to rise. Lay the groundwork for action.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/main/Day17.jpeg?raw=true" },
        { day: 18, phrase: "Day 18: A culmination of energy, preparing for a new cycle. Reflect on what you've learned.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/main/Day18.jpeg?raw=true" }
    ];

    const selectedDay = dayDetails.find(d => d.day === mappedFraction);
    const message = selectedDay ? selectedDay.phrase : "An error occurred.";
    const imageUrl = 'https://github.com/SKSineDays/SKSineDays.github.io/blob/main/${selectedDay.imageUrl}?raw=true`;

    displayMessage(message, imageUrl, 'success');
}

function displayMessage(message, imageUrl, type) {
    const resultElement = document.getElementById('result');
    resultElement.innerHTML = `<img src="${imageUrl}" alt="Day Image" style="max-width:100%;height:auto;"><p>${message}</p>`;
    resultElement.className = type;

    // Add subtle animation for displaying the result
    resultElement.style.opacity = 0;
    setTimeout(() => {
        resultElement.style.opacity = 1;
    }, 100);
}

