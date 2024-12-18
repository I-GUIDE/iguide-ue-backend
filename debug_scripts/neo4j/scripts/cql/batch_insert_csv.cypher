////////////////////////
// CSV file needs to be copied to `/var/lib/neo4j/import` directory in docker
///////////////////////
LOAD CSV FROM 'file:///notebooks.csv' AS row
MERGE (nb:Notebook { id: row[0], title: row[1], tags: row[2], contents: row[3], html_notebook: coalesce(row[4], "/images/default.png"), notebook_repo: row[5], notebook_file: row[6], thumbnail_image: row[7] })
RETURN nb.id, nb.title


LOAD CSV FROM 'file:///datasets.csv' AS row
MERGE (ds:Dataset {id: row[0], title: row[1], tags: row[2], contents: row[3], external_link: row[4], size: coalesce(row[6], "0"), thumbnail_image: row[7], featured: row[8]})
SET ds.direct_download_link = NULLIF(row[5], "")
RETURN ds.id, ds.title

LOAD CSV FROM 'file:///authors.csv' AS row
MERGE (au:Author {name: row[0], affiliation: row[2]})
SET au.bio = NULLIF(row[1], "")
SET au.thumbnail = NULLIF(row[3], "")
RETURN au.name, au.affiliation