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
        { day: 1, phrase: "Day 1: Fresh beginnings. Take the first step on new ventures with confidence.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/4581499fb12d23a75b91b0dc8c0dd5db56ea880a/Day1.jpeg" },
        { day: 2, phrase: "Day 2: Build momentum. Great day for pushing forward with your plans.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/4581499fb12d23a75b91b0dc8c0dd5db56ea880a/Day2.jpeg" },
        { day: 3, phrase: "Day 3: Creativity peaks. Let your imagination lead the way.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/4581499fb12d23a75b91b0dc8c0dd5db56ea880a/Day3.jpeg" },
        { day: 4, phrase: "Day 4: Social connections flourish. Reach out to those around you.", imageUrl: "Dhttps://github.com/SKSineDays/SKSineDays.github.io/blob/4581499fb12d23a75b91b0dc8c0dd5db56ea880a/Day4.jpeg" },
        { day: 5, phrase: "Day 5: A day of productivity. Focus on tasks that need completion.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/4581499fb12d23a75b91b0dc8c0dd5db56ea880a/Day5.jpeg" },
        { day: 6, phrase: "Day 6: Balance is key today. Find harmony in your activities.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/4581499fb12d23a75b91b0dc8c0dd5db56ea880a/Day6.jpeg" },
        { day: 7, phrase: "Day 7: Insights emerge. Pay attention to your intuition.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/4581499fb12d23a75b91b0dc8c0dd5db56ea880a/Day7.jpeg" },
        { day: 8, phrase: "Day 8: Challenges may arise. Stand firm and face them head-on.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/4581499fb12d23a75b91b0dc8c0dd5db56ea880a/Day8.jpeg" },
        { day: 9, phrase: "Day 9: Transition day. Prepare to reflect as the wave dips.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/4581499fb12d23a75b91b0dc8c0dd5db56ea880a/Day9.jpeg" },
        { day: 10, phrase: "Day 10: Reflection begins. Look inward for growth opportunities.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/4581499fb12d23a75b91b0dc8c0dd5db56ea880a/Day10.jpeg" },
        { day: 11, phrase: "Day 11: Rest and recharge. Allow yourself time to relax.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/4581499fb12d23a75b91b0dc8c0dd5db56ea880a/Day11.jpeg" },
        { day: 12, phrase: "Day 12: Reevaluate your path. Make adjustments as needed.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/4581499fb12d23a75b91b0dc8c0dd5db56ea880a/Day12.jpeg" },
        { day: 13, phrase: "Day 13: Release what no longer serves you. It's a day for letting go.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/4581499fb12d23a75b91b0dc8c0dd5db56ea880a/Day13.jpeg" },
        { day: 14, phrase: "Day 14: Inner work is favored. Dive deep into personal development.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/4581499fb12d23a75b91b0dc8c0dd5db56ea880a/Day14.jpeg" },
        { day: 15, phrase: "Day 15: Healing energies are strong. Embrace self-care.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/4581499fb12d23a75b91b0dc8c0dd5db56ea880a/Day15.jpeg" },
        { day: 16, phrase: "Day 16: Begin to look outward again. Plan for the next positive wave.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/4581499fb12d23a75b91b0dc8c0dd5db56ea880a/Day16.jpeg" },
        { day: 17, phrase: "Day 17: Energy starts to rise. Lay the groundwork for action.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/4581499fb12d23a75b91b0dc8c0dd5db56ea880a/Day17.jpeg" },
        { day: 18, phrase: "Day 18: A culmination of energy, preparing for a new cycle. Reflect on what you've learned.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/4581499fb12d23a75b91b0dc8c0dd5db56ea880a/Day18.jpeg" }
    ];

    const selectedDay = dayDetails.find(d => d.day === mappedFraction);
    const message = selectedDay ? selectedDay.phrase : "An error occurred.";
    const imageUrl = `https://github.com/SKSineDays/SKSineDays.github.io/blob/40689575c84cd91b4f98c2ff9a35ec1dd3564636/${selectedDay.imageUrl}?raw=true`;

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

