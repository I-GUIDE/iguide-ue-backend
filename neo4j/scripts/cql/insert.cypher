CREATE (ds1:Dataset {id: "ds1", title: "Twitter data", tags: ["Twitter", "Big data", "Raw data"], contents: "This dataset contains all the datasets used in the study conducted for the research publication titled \"Mapping dynamic human sentiments of heat exposure with location-based social media data", external_link: "https://figshare.com/articles/dataset/Data_Sample_for_Mapping_Dynamic_Human_Sentiments_of_Heat_Exposure_with_Location-Based_Social_Media_Data_/21780065", direct_download_link: "twitterjson-210925to210926/twitter_gz/", size: "29.80 GB", thumbnail_image: "/images/dataset_images/ds1.png", featured: true})

CREATE (nb1:Notebook { id: "nb1", title: "Data Collection", tags: ["Twitter", "Census Shapefile", "ACS", "Data Collection"], contents: "This notebook includes the data collection process for three datasets including US Census Tract Shapefile data, American Community Survey (ACS) Data, and Twitter data.", html_notebook: "/html_notebooks/Data_Collection.html", notebook_repo: "https://github.com/I-GUIDE/data-with-notebooks-inventory", notebook_file: "Data Collection.ipynb", thumbnail_image: "/images/notebook_images/nb1.png" })

CREATE (auth:Author { name: "Fangzheng Lyu", short_bio: "I am currently a Ph.D. student in the Department of Geography and GIS at the University of Illinois at Urbana-Champaign, under the supervision of Dr. Shaowen Wang. I earned my M.S. in Geography from the University of Illinois at Urbana-Champaign in 2021 and my B.E. in Computer Engineering at the University of Hong Kong in 2018. My research interests include 1) examination and evaluation of heat dynamics in the urban area with cyberGIS and high-performance geospatial computing; 2) feature extraction using Light Detection and Ranging (LiDAR) data; and 3) scientific gateway construction for accessing high-performance computer (HPC).", thumbnail_image: "" })

// Update/Add node property (affiliation) to author node
MATCH (auth:Author {name: 'Fangzheng Lyu'})
SET auth.affiliation = "University of Illinois at Urbana-Champaign"
RETURN auth

// Increment value
MATCH (c:Dataset{id:'ds2'})
SET c.click_count=coalesce(c.click_count+1, 1)
RETURN c

// create connection between dataset and notebook
MATCH (ds:Dataset {id: 'ds1'}), (nb:Notebook {id: 'nb1'})
CREATE (ds)-[:RELATED_NB]->(nb)

// create connection between dataset and author
MATCH (auth:Author {name: 'Fangzheng Lyu'}), (nb:Notebook {id: 'nb1'}), (ds:Dataset {id: 'ds1'})
CREATE (auth)-[:CREATED]->(nb)
CREATE (auth)-[:CREATED]->(ds)

// create constraints
// CREATE CONSTRAINT IF NOT EXISTS FOR (ds:Dataset) REQUIRE ds.id IS KEY // supported in enterprise
CREATE CONSTRAINT ds_constraint1 IF NOT EXISTS FOR (ds:Dataset) REQUIRE ds.id IS UNIQUE
CREATE CONSTRAINT IF NOT EXISTS FOR (ds:Dataset) REQUIRE ds.id IS NOT NULL

// delete node
MATCH (a:Author {name: 'Fangzheng Lyu'})
DETACH DELETE a

// get total node count
MATCH (n)
RETURN count(n)

// get total dataset nodes
MATCH (n:Dataset)
RETURN count(n)

// for batch insert from csv
// (1) need to copy csv to import directory

// major changes
// (1) no hyphens in names, can use underscores

// Connect to OpenSearch
CALL apoc.es.stats("https://149.165.175.42:9200")
