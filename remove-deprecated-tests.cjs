const fs = require('fs');
const content = fs.readFileSync('__tests__/iteration-loop.test.ts', 'utf8');

// Remove the onContinue callback describe block
const onContinueRegex = /describe\("onContinue callback", \(\) => \{[\s\S]*?^\s{4}\}\)/gm;
let cleanedContent = content.replace(onContinueRegex, '');

// Remove the detectCompletionMarkerFromMessages describe block  
const markerRegex = /describe\("detectCompletionMarkerFromMessages", \(\) => \{[\s\S]*?^\s{4}\}\)/gm;
cleanedContent = cleanedContent.replace(markerRegex, '');

fs.writeFileSync('__tests__/iteration-loop.test.ts', cleanedContent);
console.log('Deprecated tests removed successfully');