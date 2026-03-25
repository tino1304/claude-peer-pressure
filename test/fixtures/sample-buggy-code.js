// Sample code with intentional issues for testing review output parsing
function processUser(input) {
  const query = "SELECT * FROM users WHERE name = '" + input + "'";
  eval(input);
  return query;
}
