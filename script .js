function sinedays() {
    var birthdayInput = document.getElementById('birthday');
    var birthday = new Date(birthdayInput.value);
    var today = new Date();

    if (!birthdayInput.value) {
        updateResult("Please enter your birthday.", "", "warning");
        return;
    }
    if (birthday > today) {
        updateResult("Please enter a date that is not in the future.", "", "warning");
        return;
    }

    var differenceInTime = today.getTime() - birthday.getTime();
    var differenceInDays = differenceInTime / (1000 * 3600 * 24);
    var daysInSine = differenceInDays / 18;
    var fractionalPart = daysInSine % 1;
    var mappedFraction = Math.round(fractionalPart * 18);
    mappedFraction = mappedFraction === 0 ? 18 : mappedFraction;

    var dayDetails = [
        { day: 1, phrase: "Day 1: Fresh beginnings. Take the first step on new ventures with confidence.", imageUrl: "Day1.jpg" },
        { day: 2, phrase: "Day 2: Build momentum. Great day for pushing forward with your plans.", imageUrl: "Day2.webp" },
        { day: 3, phrase: "Day 3: Creativity peaks. Let your imagination lead the way.", imageUrl: "Day3.webp" },
        { day: 4, phrase: "Day 4: Social connections flourish. Reach out to those around you.", imageUrl: "Day4.webp" },
        { day: 5, phrase: "Day 5: A day of productivity. Focus on tasks that need completion.", imageUrl: "Day5.webp" },
        { day: 6, phrase: "Day 6: Balance is key today. Find harmony in your activities.", imageUrl: "Day6.webp" },
        { day: 7, phrase: "Day 7: Insights emerge. Pay attention to your intuition.", imageUrl: "https://github.com/SKSineDays/SKSineDays.github.io/blob/40689575c84cd91b4f98c2ff9a35ec1dd3564636/Day7.webp" },
        { day: 8, phrase: "Day 8: Challenges may arise. Stand firm and face them head-on.", imageUrl: "Day8.webp" },
        { day: 9, phrase: "Day 9: Transition day. Prepare to reflect as the wave dips.", imageUrl: "Day9.webp" },
        { day: 10, phrase: "Day 10: Reflection begins. Look inward for growth opportunities.", imageUrl: "Day10.webp" },
        { day: 11, phrase: "Day 11: Rest and recharge. Allow yourself time to relax.", imageUrl: "Day11.webp" },
        { day: 12, phrase: "Day 12: Reevaluate your path. Make adjustments as needed.", imageUrl: "Day12.webp" },
        { day: 13, phrase: "Day 13: Release what no longer serves you. It's a day for letting go.", imageUrl: "Day14.webp" }, // Day 13's image and phrase may need adjustment
        { day: 14, phrase: "Day 14: Inner work is favored. Dive deep into personal development.", imageUrl: "Day14.webp" },
        { day: 15, phrase: "Day 15: Healing energies are strong. Embrace self-care.", imageUrl: "Day15.webp" },
        { day: 16, phrase: "Day 16: Begin to look outward again. Plan for the next positive wave.", imageUrl: "Day16.webp" },
        { day: 17, phrase: "Day 17: Energy starts to rise. Lay the groundwork for action.", imageUrl: "Day17.webp" },
        { day: 18, phrase: "Day 18: A culmination of energy, preparing for a new cycle. Reflect on what you've learned.", imageUrl: "Day18.webp" }
    ];

    var selectedDay = dayDetails.find(d => d.day === mappedFraction);
    var message = selectedDay ? selectedDay.phrase : "An error occurred.";
    var imageUrl = `https://sksinedays.github.io/40689575c84cd91b4f98c2ff9a35ec1dd3564636/${selectedDay.imageUrl}`;

    updateResult(message, imageUrl, "success");
}

function updateResult(message, imageUrl, type) {
    var resultElement = document.getElementById('result');
    resultElement.innerHTML = `<img src="${imageUrl}" alt="Day Image" style="max-width:100%;height:auto;"><p>${message}</p>`;
    resultElement.className = type;
}
