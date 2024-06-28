 import fetch from 'node-fetch'
function fetchRelatedResourceTitles(field, ids) {
  return Promise.all(
    fetch(`http://149.165.154.200:5001/api/resources/${field}/${ids}`)
      .then(response => response.json())
      .then(data => data.title)
  );
}

console.log(fetchRelatedResourceTitles('_id',  [ "B0l1W5ABQn4vdKPaEqJ7", "CEl1W5ABQn4vdKPaEqKQ", "CUl1W5ABQn4vdKPaEqKd" ]));
